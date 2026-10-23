import type { Log } from 'sarif';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT_ERROR, EXIT_FAIL_ON, EXIT_OK, main } from '../src/main.js';
import { createFixtureRepo } from './helpers/fixture.js';
import { createRepo, lines, type TestRepo } from './helpers/repo.js';

function cli(args: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = main(args, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

/**
 * A synthetic e-commerce repo whose last commit touches a payment module, a webhook, a
 * renamed pricing file and an ordinary catalog file — none of them built-in sensitive paths.
 */
let shop: TestRepo;
beforeAll(() => {
  shop = createRepo();
  shop.write('src/payments/charge.ts', lines(5));
  shop.write('src/pricing/discounts.ts', lines(5));
  shop.write('src/catalog/list.ts', lines(5));
  shop.write('api/webhooks/stripe.ts', lines(3));
  shop.commit('init');
  shop.write('src/payments/charge.ts', lines(5).replace('line 2\n', 'line 2 retries\n'));
  shop.write('api/webhooks/stripe.ts', lines(3).replace('line 1\n', 'line 1 verify\n'));
  shop.remove('src/pricing/discounts.ts');
  shop.write('src/promo/discounts.ts', lines(5));
  shop.write('src/catalog/list.ts', lines(5).replace('line 4\n', 'line 4 sort\n'));
  shop.commit('feat: agent change');
});
afterAll(() => shop.cleanup());

const json = (stdout: string) =>
  JSON.parse(stdout) as {
    files: { path: string; hunks: { level: string; rule: string; reason: string }[] }[];
  };

describe('--sensitive-path end to end', () => {
  it('is a no-op when absent: no custom file is flagged', () => {
    const r = cli([], shop.dir);
    expect(r).toMatchObject({ code: EXIT_OK, stdout: 'No risk signals found.\n', stderr: '' });
  });

  it('flags files matching one pattern as HIGH in Markdown', () => {
    const r = cli(['--sensitive-path', 'src/payments/**'], shop.dir);
    expect(r.code).toBe(EXIT_OK);
    expect(r.stdout).toContain('## `src/payments/charge.ts`');
    expect(r.stdout).toContain(
      '- L2-2: [HIGH] Matches project sensitive path `src/payments/**`; review with extra care (path heuristic)',
    );
    expect(r.stdout).not.toContain('src/catalog/list.ts');
  });

  it('accepts the flag several times, and --flag=value form', () => {
    const r = cli(
      ['--sensitive-path', 'src/payments/**', '--sensitive-path=**/webhooks/*.ts'],
      shop.dir,
    );
    const flagged = json(
      cli(
        [
          '--format',
          'json',
          '--sensitive-path',
          'src/payments/**',
          '--sensitive-path=**/webhooks/*.ts',
        ],
        shop.dir,
      ).stdout,
    )
      .files.map((f) => f.path)
      .sort();
    expect(r.code).toBe(EXIT_OK);
    expect(flagged).toEqual(['api/webhooks/stripe.ts', 'src/payments/charge.ts']);
  });

  it('matches renames by their old path', () => {
    const files = json(
      cli(['--format', 'json', '--sensitive-path', 'src/pricing/**'], shop.dir).stdout,
    ).files;
    expect(files.map((f) => f.path)).toEqual(['src/promo/discounts.ts']);
    expect(files[0]?.hunks[0]).toMatchObject({ level: 'HIGH', rule: 'E' });
  });

  it('accepts Windows-style separators', () => {
    const a = cli(['--sensitive-path', 'src\\payments\\**'], shop.dir);
    const b = cli(['--sensitive-path', 'src/payments/**'], shop.dir);
    expect(a.stdout).toBe(b.stdout);
  });

  it('is deterministic regardless of flag order or duplicates', () => {
    const one = cli(
      ['--sensitive-path', 'src/**', '--sensitive-path', '**/webhooks/*.ts'],
      shop.dir,
    );
    const two = cli(
      [
        '--sensitive-path',
        '**/webhooks/*.ts',
        '--sensitive-path',
        'src/**',
        '--sensitive-path',
        './src/**',
      ],
      shop.dir,
    );
    expect(two.stdout).toBe(one.stdout);
  });

  it('feeds --fail-on: a custom HIGH alone triggers exit 2', () => {
    expect(cli(['--fail-on', 'high'], shop.dir).code).toBe(EXIT_OK);
    const r = cli(['--fail-on', 'high', '--sensitive-path', 'src/payments/**'], shop.dir);
    expect(r.code).toBe(EXIT_FAIL_ON);
    expect(r.stdout).toContain('[HIGH]');
  });

  it('produces valid JSON and SARIF with the custom signal', () => {
    const files = json(
      cli(['--format', 'json', '--sensitive-path', 'src/payments/**'], shop.dir).stdout,
    ).files;
    expect(files[0]?.hunks[0]).toMatchObject({
      level: 'HIGH',
      rule: 'E',
      reason: expect.stringContaining('`src/payments/**`'),
    });

    const log = JSON.parse(
      cli(['--format', 'sarif', '--sensitive-path', 'src/payments/**'], shop.dir).stdout,
    ) as Log;
    const results = log.runs[0]?.results ?? [];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ruleId: 'RA-E', level: 'error' });
    expect(results[0]?.locations?.[0]?.physicalLocation?.artifactLocation?.uri).toBe(
      'src/payments/charge.ts',
    );
  });

  it.each([
    [['--sensitive-path', '../etc/**'], /"\.\." segments are not allowed/],
    [['--sensitive-path', '/abs/**'], /not an absolute path/],
    [['--sensitive-path', 'src/*.{ts,js}'], /unsupported glob syntax "\{"/],
    [['--sensitive-path', ''], /pattern is empty/],
    [['--sensitive-path'], /argument missing|--sensitive-path/],
  ])('rejects %j with exit 1 and no report', (args, message) => {
    const r = cli(args, shop.dir);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(message);
    expect(r.stderr).toContain('risk-annotate --help');
  });

  it('validates patterns before touching the repository', () => {
    // Invalid pattern + not-a-repo: the pattern error wins, so no git command runs first.
    const r = cli(['--sensitive-path', '/abs', '--cwd', '/definitely/not/a/repo'], shop.dir);
    expect(r.stderr).toMatch(/not an absolute path/);
  });

  it('documents the flag in --help', () => {
    expect(cli(['--help'], shop.dir).stdout).toContain('--sensitive-path <glob>');
  });
});

describe('existing behavior is preserved', () => {
  let fixture: TestRepo;
  beforeAll(() => {
    fixture = createFixtureRepo();
  });
  afterAll(() => fixture.cleanup());

  it('a pattern matching nothing leaves every format byte-identical', () => {
    for (const format of ['markdown', 'json', 'sarif']) {
      const base = cli(['--format', format], fixture.dir);
      const withFlag = cli(
        ['--format', format, '--sensitive-path', 'nothing/matches/**'],
        fixture.dir,
      );
      expect(withFlag.stdout).toBe(base.stdout);
      expect(withFlag.code).toBe(base.code);
    }
  });

  it('built-in HIGH files keep their specific reasons alongside custom patterns', () => {
    const r = cli(['--sensitive-path', 'src/**'], fixture.dir);
    expect(r.stdout).toContain(
      '[HIGH] Touches auth code; check session, token and permission handling',
    );
  });
});
