import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EXIT_ERROR, EXIT_FAIL_ON, EXIT_OK, main } from '../src/main.js';
import { VERSION } from '../src/version.js';
import { createFixtureRepo } from './helpers/fixture.js';
import { createRepo, type TestRepo } from './helpers/repo.js';

function cli(args: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = main(args, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

let fixture: TestRepo;
beforeAll(() => {
  fixture = createFixtureRepo();
});
afterAll(() => fixture.cleanup());

let scratch: TestRepo | undefined;
afterEach(() => {
  scratch?.cleanup();
  scratch = undefined;
});

/** Repo whose HEAD change only trips LOW/MED or nothing. */
function quietRepo(content = 'y\n') {
  scratch = createRepo();
  scratch.write('src/x.ts', 'x\n');
  scratch.commit('init');
  scratch.write('src/x.ts', content);
  scratch.commit('edit');
  return scratch.dir;
}

describe('flags', () => {
  it('--version and -v print the version', () => {
    expect(cli(['--version'], fixture.dir)).toEqual({
      code: EXIT_OK,
      stdout: `${VERSION}\n`,
      stderr: '',
    });
    expect(cli(['-v'], fixture.dir).stdout).toBe(`${VERSION}\n`);
  });

  it('--help documents every flag and exit code', () => {
    const { code, stdout } = cli(['--help'], fixture.dir);
    expect(code).toBe(EXIT_OK);
    for (const s of [
      '--base',
      '--head',
      '--format',
      '--fail-on',
      '--coverage',
      '--cwd',
      '0  success',
      '2  --fail-on',
    ]) {
      expect(stdout).toContain(s);
    }
  });

  it.each([
    [['--nope'], /Unknown option '--nope'/],
    [['stray'], /Unexpected argument 'stray'/],
    [['--format', 'xml'], /--format must be one of: markdown, json, sarif/],
    [['--fail-on', 'critical'], /--fail-on must be one of: high, med, low/],
    [['--base'], /argument missing|requires a value|--base/],
  ])('%j → exit 1 with a usage hint', (args, message) => {
    const { code, stdout, stderr } = cli(args, fixture.dir);
    expect(code).toBe(EXIT_ERROR);
    expect(stdout).toBe('');
    expect(stderr).toMatch(message);
    expect(stderr).toContain('risk-annotate --help');
  });
});

describe('runtime errors exit 1', () => {
  it('unknown revision', () => {
    const r = cli(['--base', 'does-not-exist'], fixture.dir);
    expect(r).toMatchObject({ code: EXIT_ERROR, stdout: '' });
    expect(r.stderr).toBe('risk-annotate: unknown revision: does-not-exist\n');
  });

  it('not a git repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'risk-annotate-norepo-'));
    try {
      expect(cli([], dir)).toMatchObject({
        code: EXIT_ERROR,
        stderr: expect.stringMatching(/not a git repository/),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('missing explicit coverage file', () => {
    expect(cli(['--coverage', 'nope.json'], fixture.dir)).toMatchObject({
      code: EXIT_ERROR,
      stderr: 'risk-annotate: coverage file not found: nope.json\n',
    });
  });
});

describe('--fail-on', () => {
  it('exits 2 when an annotation meets the level, still printing the report', () => {
    const r = cli(['--fail-on', 'high'], fixture.dir);
    expect(r.code).toBe(EXIT_FAIL_ON);
    expect(r.stdout).toContain('# Risk annotations');
    expect(r.stderr).toBe('risk-annotate: found annotations at or above HIGH\n');
  });

  it('is case-insensitive and accepts "medium"', () => {
    expect(cli(['--fail-on', 'MED'], fixture.dir).code).toBe(EXIT_FAIL_ON);
    expect(cli(['--fail-on', 'medium'], fixture.dir).code).toBe(EXIT_FAIL_ON);
  });

  it('exits 0 below the threshold and when nothing is found', () => {
    expect(cli(['--fail-on', 'low'], quietRepo())).toMatchObject({
      code: EXIT_OK,
      stdout: 'No risk signals found.\n',
    });
  });

  it('a LOW-only result passes --fail-on med but fails --fail-on low', () => {
    scratch = createRepo();
    for (let i = 0; i < 3; i++) {
      scratch.write(`n${i}.txt`, 'a\n');
      scratch.commit(`n${i}`);
    }
    scratch.write('big.txt', 'x\n'.repeat(50));
    scratch.commit('big');
    expect(cli(['--fail-on', 'med'], scratch.dir).code).toBe(EXIT_OK);
    expect(cli(['--fail-on', 'low'], scratch.dir).code).toBe(EXIT_FAIL_ON);
  });
});

describe('options', () => {
  it('--format json and sarif produce parseable output', () => {
    expect(JSON.parse(cli(['--format', 'json'], fixture.dir).stdout).schemaVersion).toBe(1);
    expect(JSON.parse(cli(['--format', 'sarif'], fixture.dir).stdout).version).toBe('2.1.0');
  });

  it('--cwd overrides the process directory', () => {
    const elsewhere = mkdtempSync(join(tmpdir(), 'risk-annotate-elsewhere-'));
    try {
      const r = cli(['--cwd', fixture.dir], elsewhere);
      expect(r.code).toBe(EXIT_OK);
      expect(r.stdout).toContain('src/auth/login.ts');
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('--base/--head select a range', () => {
    const r = cli(['--base', 'HEAD~2', '--head', 'HEAD~1', '--format', 'json'], fixture.dir);
    expect(JSON.parse(r.stdout).range).toEqual({ base: 'HEAD~2', head: 'HEAD~1', threeDot: true });
  });

  it('prints coverage warnings to stderr without failing', () => {
    const dir = quietRepo();
    scratch?.write('coverage/coverage-final.json', '{ broken');
    const r = cli([], dir);
    expect(r.code).toBe(EXIT_OK);
    expect(r.stderr).toMatch(/^risk-annotate: warning: ignoring coverage\/coverage-final\.json/);
  });
});
