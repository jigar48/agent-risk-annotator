import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCoveragePy } from '../src/coverage/coveragepy.js';
import {
  CoverageError,
  createReport,
  loadCoverage,
  readCoverageFile,
} from '../src/coverage/index.js';
import { parseIstanbul } from '../src/coverage/istanbul.js';
import { parseLcov } from '../src/coverage/lcov.js';
import type { FileCoverage, RawCoverage } from '../src/coverage/types.js';

const loc = (start: number, end = start) => ({
  start: { line: start, column: 0 },
  end: { line: end, column: 10 },
});

const ISTANBUL = {
  '/repo/src/a.ts': {
    path: '/repo/src/a.ts',
    statementMap: { '0': loc(1), '1': loc(2), '2': loc(2), '3': loc(6) },
    s: { '0': 3, '1': 0, '2': 5, '3': 0 },
    fnMap: {
      '0': { name: 'used', decl: loc(1), loc: loc(1, 3), line: 1 },
      '1': { name: 'dead', decl: loc(5), loc: loc(5, 7), line: 5 },
    },
    f: { '0': 3, '1': 0 },
    branchMap: {},
    b: {},
  },
};

const LCOV = [
  'TN:',
  'SF:src/a.ts',
  'FN:1,used',
  'FN:5,7,dead',
  'FNDA:3,used',
  'FNDA:0,dead',
  'DA:1,3',
  'DA:2,5',
  'DA:6,0',
  'end_of_record',
  'SF:src/b.ts',
  'DA:1,0',
  'end_of_record',
  'SF:src/a.ts',
  'DA:6,2',
  'end_of_record',
  '',
].join('\n');

const COVERAGE_PY = {
  meta: { format: 3, version: '7.6.1' },
  files: {
    'pkg/mod.py': {
      executed_lines: [1, 2, 3],
      missing_lines: [6, 7],
      functions: {
        '': { executed_lines: [1], missing_lines: [] },
        used: { executed_lines: [2, 3], missing_lines: [] },
        dead: { executed_lines: [], missing_lines: [6, 7] },
      },
    },
    'pkg/old.py': { executed_lines: [1], missing_lines: [2] },
  },
};

describe('parseIstanbul', () => {
  it('derives line hits from statement starts (max per line) and keeps function spans', () => {
    const fc = parseIstanbul(ISTANBUL).files.get('/repo/src/a.ts');
    expect([...(fc?.lines ?? [])]).toEqual([
      [1, 3],
      [2, 5],
      [6, 0],
    ]);
    expect(fc?.functions).toEqual([
      { name: 'used', start: 1, end: 3, hits: 3 },
      { name: 'dead', start: 5, end: 7, hits: 0 },
    ]);
  });

  it('rejects non-istanbul JSON', () => {
    expect(() => parseIstanbul([])).toThrow(CoverageError);
    expect(() => parseIstanbul({ 'a.ts': { nope: true } })).toThrow(/malformed/);
  });
});

describe('parseLcov', () => {
  it('reads DA, both FN forms, FNDA, and merges repeated SF records', () => {
    const raw = parseLcov(LCOV);
    const a = raw.files.get('src/a.ts');
    expect(a?.lines.get(6)).toBe(2); // max of 0 and the later record's 2
    expect(a?.functions).toEqual([
      { name: 'used', start: 1, end: null, hits: 3 },
      { name: 'dead', start: 5, end: 7, hits: 0 },
    ]);
    expect([...(raw.files.get('src/b.ts')?.lines ?? [])]).toEqual([[1, 0]]);
  });

  it('rejects files with no records', () => {
    expect(() => parseLcov('hello\n')).toThrow(/no SF/);
  });
});

describe('parseCoveragePy', () => {
  it('maps executed/missing lines and per-function regions, skipping module scope', () => {
    const raw = parseCoveragePy(COVERAGE_PY);
    const mod = raw.files.get('pkg/mod.py');
    expect(mod?.lines.get(2)).toBe(1);
    expect(mod?.lines.get(6)).toBe(0);
    expect(mod?.functions).toEqual([
      { name: 'used', start: 2, end: 3, hits: 1 },
      { name: 'dead', start: 6, end: 7, hits: 0 },
    ]);
  });

  it('accepts pre-7.5 reports without function data', () => {
    expect(parseCoveragePy(COVERAGE_PY).files.get('pkg/old.py')?.functions).toEqual([]);
  });

  it('rejects JSON without a files object', () => {
    expect(() => parseCoveragePy({ meta: {} })).toThrow(/"files"/);
  });
});

describe('createReport path mapping', () => {
  const fc = (): FileCoverage => ({ lines: new Map([[1, 1]]), functions: [] });
  const raw = (...paths: string[]): RawCoverage => ({
    format: 'istanbul',
    files: new Map(paths.map((p) => [p, fc()])),
  });

  it('strips the repo root from absolute paths', () => {
    const r = createReport(raw('/home/me/repo/src/a.ts'), '/home/me/repo', 'x');
    expect(r.lookup('src/a.ts')).toBeDefined();
  });

  it('suffix-matches absolute paths from another machine', () => {
    const r = createReport(raw('/home/runner/work/repo/repo/src/a.ts'), '/local/repo', 'x');
    expect(r.lookup('src/a.ts')).toBeDefined();
  });

  it('suffix-matches package-relative paths in a monorepo', () => {
    const r = createReport(raw('src/a.ts'), '/repo', 'x');
    expect(r.lookup('packages/web/src/a.ts')).toBeDefined();
  });

  it('normalizes Windows separators and ./ prefixes', () => {
    expect(
      createReport(raw('D:\\ci\\repo\\src\\a.ts'), '/r', 'x').lookup('src/a.ts'),
    ).toBeDefined();
    expect(createReport(raw('./src/a.ts'), '/r', 'x').lookup('src/a.ts')).toBeDefined();
  });

  it('returns nothing for ambiguous or unknown paths instead of guessing', () => {
    const r = createReport(raw('/x/one/index.ts', '/x/two/index.ts'), '/r', 'x');
    expect(r.lookup('index.ts')).toBeUndefined();
    expect(r.lookup('one/index.ts')).toBeDefined();
    expect(r.lookup('missing.ts')).toBeUndefined();
  });

  it('does not match on partial file names', () => {
    const r = createReport(raw('src/xa.ts'), '/r', 'x');
    expect(r.lookup('a.ts')).toBeUndefined();
  });
});

describe('loadCoverage', () => {
  let root: string;
  const put = (rel: string, content: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'risk-annotate-cov-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns null when no report exists', () => {
    expect(loadCoverage(root)).toEqual({ report: null, warnings: [] });
  });

  it('auto-detects in priority order', () => {
    put('coverage.json', JSON.stringify(COVERAGE_PY));
    put('coverage/lcov.info', LCOV);
    expect(loadCoverage(root).report?.format).toBe('lcov');
    put('coverage/coverage-final.json', JSON.stringify(ISTANBUL));
    expect(loadCoverage(root).report?.format).toBe('istanbul');
  });

  it('detects coverage.py JSON by its meta + files shape', () => {
    put('coverage.json', JSON.stringify(COVERAGE_PY));
    const { report } = loadCoverage(root);
    expect(report?.format).toBe('coverage.py');
    expect(report?.lookup('pkg/mod.py')?.lines.get(6)).toBe(0);
  });

  it('skips a broken auto-detected file with a warning and keeps probing', () => {
    put('coverage/coverage-final.json', '{ not json');
    put('lcov.info', LCOV);
    const { report, warnings } = loadCoverage(root);
    expect(report?.format).toBe('lcov');
    expect(warnings).toEqual([
      'ignoring coverage/coverage-final.json: coverage-final.json is not valid JSON',
    ]);
  });

  it('throws for a missing or broken explicit path', () => {
    expect(() => loadCoverage(root, 'nope.json')).toThrow(/coverage file not found: nope.json/);
    put('bad.json', '[]');
    expect(() => loadCoverage(root, 'bad.json')).toThrow(CoverageError);
  });

  it('resolves an explicit relative path against cwd', () => {
    put('sub/out/cov.info', LCOV);
    const { report } = loadCoverage(root, 'out/cov.info', join(root, 'sub'));
    expect(report?.lookup('src/b.ts')).toBeDefined();
  });

  it('sniffs lcov content without a known extension', () => {
    put('tracefile', LCOV);
    expect(readCoverageFile(join(root, 'tracefile')).format).toBe('lcov');
  });
});
