import { describe, expect, it } from 'vitest';
import { createReport } from '../../src/coverage/index.js';
import type { FileCoverage, FunctionCoverage } from '../../src/coverage/types.js';
import { ruleB } from '../../src/rules/b-coverage.js';
import type { Hunk } from '../../src/diff/parse.js';
import { change, fakeContext, hunk } from '../helpers/context.js';

function cov(lines: [number, number][], functions: FunctionCoverage[] = []): FileCoverage {
  return { lines: new Map(lines), functions };
}

/** The report always describes src/a.ts; `path` is the file being changed. */
function run(fc: FileCoverage | null, h: Hunk, path = 'src/a.ts') {
  const file = change(path, { hunks: [h] });
  const coverage = fc
    ? createReport({ format: 'istanbul', files: new Map([['src/a.ts', fc]]) }, '/repo', 'x')
    : null;
  return ruleB.checkHunk?.(file, h, fakeContext([file], { coverage })) ?? [];
}

const at = (start: number, n = 1) =>
  hunk(
    start,
    Array.from({ length: n }, () => 'x'),
    [],
  );

describe('Rule B — uncovered code', () => {
  it('flags changes in a file with 0% coverage', () => {
    expect(
      run(
        cov([
          [1, 0],
          [2, 0],
          [5, 0],
        ]),
        at(2),
      ),
    ).toEqual([
      {
        level: 'MED',
        evidence: 'coverage report',
        reason: 'Changes a file with 0% test coverage; no test exercises these lines',
      },
    ]);
  });

  it('flags changes inside a 0%-coverage function, naming it', () => {
    const fc = cov(
      [
        [1, 4],
        [10, 0],
        [11, 0],
      ],
      [
        { name: 'used', start: 1, end: 3, hits: 4 },
        { name: 'neverCalled', start: 10, end: 14, hits: 0 },
      ],
    );
    expect(run(fc, at(12))[0]?.reason).toBe(
      'Changes neverCalled(), which has 0% test coverage; no test exercises it',
    );
    // A hunk that only overlaps the function's edge still counts.
    expect(run(fc, at(8, 3))).toHaveLength(1);
  });

  it('labels istanbul anonymous functions readably', () => {
    const fc = cov([[1, 1]], [{ name: '(anonymous_3)', start: 5, end: 6, hits: 0 }]);
    expect(run(fc, at(5))[0]?.reason).toMatch(/^Changes an anonymous function,/);
  });

  it('ignores covered code, pure deletions and unreported files', () => {
    const fc = cov(
      [
        [1, 4],
        [10, 0],
      ],
      [{ name: 'dead', start: 10, end: 12, hits: 0 }],
    );
    expect(run(fc, at(2))).toEqual([]);
    expect(run(fc, hunk(11, [], ['gone']))).toEqual([]);
    expect(run(fc, at(11), 'src/other.ts')).toEqual([]);
  });

  it('is silent without a coverage report', () => {
    expect(run(null, at(1))).toEqual([]);
  });

  it('infers lcov 1.x function ends from the next function start', () => {
    const fc = cov(
      [
        [1, 1],
        [20, 1],
      ],
      [
        { name: 'dead', start: 5, end: null, hits: 0 },
        { name: 'live', start: 15, end: null, hits: 2 },
      ],
    );
    expect(run(fc, at(14))[0]?.reason).toMatch(/^Changes dead\(\)/);
    expect(run(fc, at(16))).toEqual([]);
  });
});
