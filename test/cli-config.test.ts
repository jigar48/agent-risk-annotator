import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Log } from 'sarif';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG_FILE } from '../src/config.js';
import { buildContext } from '../src/context.js';
import { EXIT_ERROR, EXIT_FAIL_ON, EXIT_OK, HELP, main } from '../src/main.js';
import { createFixtureRepo } from './helpers/fixture.js';
import { createRepo, lines, type TestRepo } from './helpers/repo.js';

function cli(args: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = main(args, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

const json = (stdout: string) =>
  JSON.parse(stdout) as {
    files: { path: string; hunks: { level: string; rule: string; reason: string }[] }[];
  };

/**
 * A synthetic e-commerce repo. The change under review touches checkout, payments, an auth
 * helper (a built-in sensitive path), and an ordinary catalog file.
 */
let shop: TestRepo;
beforeAll(() => {
  shop = createRepo();
  shop.write('src/checkout/total.ts', lines(5));
  shop.write('src/payments/charge.ts', lines(5));
  shop.write('src/auth/session.ts', lines(3));
  shop.write('src/catalog/list.ts', lines(5));
  shop.commit('init');
  shop.write('src/checkout/total.ts', lines(5).replace('line 3\n', 'line 3 coupon\n'));
  shop.write('src/payments/charge.ts', lines(5).replace('line 2\n', 'line 2 retries\n'));
  shop.write('src/auth/session.ts', lines(3).replace('line 1\n', 'line 1 ttl\n'));
  shop.write('src/catalog/list.ts', lines(5).replace('line 4\n', 'line 4 sort\n'));
  shop.commit('feat: agent change');
});
afterAll(() => shop.cleanup());

const writeConfig = (repo: TestRepo, value: unknown) =>
  repo.write(CONFIG_FILE, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
afterEach(() => rmSync(join(shop.dir, CONFIG_FILE), { recursive: true, force: true }));

const flagged = (stdout: string) => json(stdout).files.map((f) => f.path);

describe('.riskannotate.json end to end', () => {
  it('without a config, behaves exactly as before', () => {
    const r = cli(['--format', 'json'], shop.dir);
    expect(r.code).toBe(EXIT_OK);
    expect(r.stderr).toBe('');
    expect(flagged(r.stdout)).toEqual(['src/auth/session.ts']);
  });

  it('flags configured paths HIGH under Rule E', () => {
    writeConfig(shop, { version: 1, sensitivePaths: ['src/payments/**', 'src/checkout/**'] });
    const r = cli([], shop.dir);
    expect(r.code).toBe(EXIT_OK);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain(
      '- L3-3: [HIGH] Matches project sensitive path `src/checkout/**`; review with extra care (path heuristic)',
    );
    expect(r.stdout).toContain(
      '- L2-2: [HIGH] Matches project sensitive path `src/payments/**`; review with extra care (path heuristic)',
    );
    expect(r.stdout).not.toContain('src/catalog/list.ts');
  });

  it('keeps the built-in reason for built-in paths, even when a config pattern also matches', () => {
    writeConfig(shop, { version: 1, sensitivePaths: ['src/**'] });
    const r = cli([], shop.dir);
    expect(r.stdout).toContain(
      '[HIGH] Touches auth code; check session, token and permission handling',
    );
    expect(r.stdout).toContain('Matches project sensitive path `src/**`');
  });

  it('an empty sensitivePaths list changes nothing', () => {
    const before = cli(['--format', 'json'], shop.dir).stdout;
    writeConfig(shop, { version: 1, sensitivePaths: [] });
    expect(cli(['--format', 'json'], shop.dir).stdout).toBe(before);
    writeConfig(shop, { version: 1 });
    expect(cli(['--format', 'json'], shop.dir).stdout).toBe(before);
  });

  it('combines config patterns with --sensitive-path flags', () => {
    writeConfig(shop, { version: 1, sensitivePaths: ['src/payments/**'] });
    const r = cli(['--format', 'json', '--sensitive-path', 'src/checkout/**'], shop.dir);
    expect(flagged(r.stdout).sort()).toEqual([
      'src/auth/session.ts',
      'src/checkout/total.ts',
      'src/payments/charge.ts',
    ]);
  });

  it('dedupes across sources and ignores the order of entries and flags', () => {
    writeConfig(shop, { version: 1, sensitivePaths: ['src/payments/**', './src/checkout/'] });
    const one = cli(
      ['--sensitive-path', 'src\\checkout\\**', '--sensitive-path', 'src/**'],
      shop.dir,
    );
    writeConfig(shop, {
      version: 1,
      sensitivePaths: ['src/checkout/**', 'src/payments/**', 'src/**'],
    });
    const two = cli([], shop.dir);
    expect(one.code).toBe(EXIT_OK);
    expect(two.stdout).toBe(one.stdout);
  });

  it('produces byte-identical Markdown, JSON and SARIF to the equivalent flags', () => {
    const patterns = ['src/payments/**', 'src/checkout/**'];
    const flags = patterns.flatMap((p) => ['--sensitive-path', p]);
    for (const format of ['markdown', 'json', 'sarif']) {
      const viaFlags = cli(['--format', format, ...flags], shop.dir);
      writeConfig(shop, { version: 1, sensitivePaths: patterns });
      const viaConfig = cli(['--format', format], shop.dir);
      rmSync(join(shop.dir, CONFIG_FILE));
      expect(viaConfig).toEqual(viaFlags);
    }
    writeConfig(shop, { version: 1, sensitivePaths: patterns });
    const log = JSON.parse(cli(['--format', 'sarif'], shop.dir).stdout) as Log;
    const uris = (log.runs[0]?.results ?? []).map(
      (r) => r.locations?.[0]?.physicalLocation?.artifactLocation?.uri,
    );
    expect(uris).toEqual(
      expect.arrayContaining(['src/checkout/total.ts', 'src/payments/charge.ts']),
    );
  });

  it('is deterministic across repeated runs', () => {
    writeConfig(shop, { version: 1, sensitivePaths: ['src/payments/**', 'src/checkout/**'] });
    const runs = [1, 2, 3].map(() => cli(['--format', 'json'], shop.dir).stdout);
    expect(new Set(runs).size).toBe(1);
  });

  it('feeds --fail-on: a configured path alone triggers exit 2', () => {
    const plain = cli(['--fail-on', 'high', '--format', 'json'], shop.dir);
    expect(plain.code).toBe(EXIT_FAIL_ON); // the built-in auth path is already HIGH
    const onlyCatalog = createRepo();
    try {
      onlyCatalog.write('src/catalog/list.ts', lines(3));
      onlyCatalog.commit('init');
      onlyCatalog.write('src/catalog/list.ts', lines(3).replace('line 1\n', 'line 1 x\n'));
      onlyCatalog.commit('change');
      expect(cli(['--fail-on', 'high'], onlyCatalog.dir).code).toBe(EXIT_OK);
      writeConfig(onlyCatalog, { version: 1, sensitivePaths: ['src/catalog/**'] });
      expect(cli(['--fail-on', 'high'], onlyCatalog.dir).code).toBe(EXIT_FAIL_ON);
    } finally {
      onlyCatalog.cleanup();
    }
  });

  it('finds the config at the repository root when run from a nested directory', () => {
    writeConfig(shop, { version: 1, sensitivePaths: ['src/payments/**'] });
    const nested = join(shop.dir, 'src', 'payments');
    expect(flagged(cli(['--format', 'json'], nested).stdout)).toContain('src/payments/charge.ts');
    expect(flagged(cli(['--format', 'json', '--cwd', nested], shop.dir).stdout)).toContain(
      'src/payments/charge.ts',
    );
    expect(buildContext({ cwd: nested }).sensitivePaths).toEqual(['src/payments/**']);
  });

  it('accepts Windows-style separators in the config', () => {
    writeConfig(shop, '{ "version": 1, "sensitivePaths": ["src\\\\payments\\\\**"] }');
    expect(buildContext({ cwd: shop.dir }).sensitivePaths).toEqual(['src/payments/**']);
  });

  it.each([
    ['{ "version": 1, ', /\.riskannotate\.json: invalid JSON/],
    [{ version: 2, sensitivePaths: [] }, /unsupported version 2/],
    [{ version: 1, ignore: ['src/**'] }, /unknown property "ignore"/],
    [
      { version: 1, sensitivePaths: ['../etc/**'] },
      /sensitivePaths\[0\] "\.\.\/etc\/\*\*": "\.\." segments/,
    ],
    [{ version: 1, sensitivePaths: ['src/*.{ts,js}'] }, /unsupported glob syntax "\{"/],
  ])('fails closed on an invalid config %j: exit 1, no report', (value, message) => {
    writeConfig(shop, value);
    for (const format of ['markdown', 'json', 'sarif']) {
      const r = cli(['--format', format], shop.dir);
      expect(r.code).toBe(EXIT_ERROR);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^risk-annotate: /);
      expect(r.stderr).toMatch(message);
    }
  });

  it('caps the combined unique patterns from config and flags at 100', () => {
    const fromConfig = Array.from({ length: 60 }, (_, i) => `c${i}/**`);
    const fromFlags = Array.from({ length: 41 }, (_, i) => `f${i}/**`);
    writeConfig(shop, { version: 1, sensitivePaths: fromConfig });
    const flags = fromFlags.flatMap((p) => ['--sensitive-path', p]);
    const r = cli(flags, shop.dir);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/at most 100 unique sensitive-path patterns .* \(got 101\)/);
    // Overlap is counted once.
    expect(cli([...flags.slice(0, -2), '--sensitive-path', 'c0/**'], shop.dir).code).toBe(EXIT_OK);
  });

  it('still validates --sensitive-path before reading the config or the repository', () => {
    writeConfig(shop, '{ broken');
    const r = cli(['--sensitive-path', '/abs'], shop.dir);
    expect(r.stderr).toMatch(/--sensitive-path "\/abs": .*not an absolute path/);
  });

  it('reads the working-tree file, not a committed or ignored copy elsewhere', () => {
    writeConfig(shop, { version: 1, sensitivePaths: ['src/payments/**'] });
    // Untracked is fine: discovery is a plain file read at the git top level.
    expect(shop.git('status', '--porcelain')).toContain(CONFIG_FILE);
    expect(flagged(cli(['--format', 'json'], shop.dir).stdout)).toContain('src/payments/charge.ts');
  });

  it('documents the file in --help', () => {
    expect(HELP).toContain(CONFIG_FILE);
    expect(cli(['--help'], shop.dir).stdout).toContain('"sensitivePaths"');
  });
});

describe('golden output is unchanged', () => {
  let fixture: TestRepo;
  beforeAll(() => {
    fixture = createFixtureRepo();
  });
  afterAll(() => fixture.cleanup());

  const golden = (name: string) =>
    readFileSync(new URL(`./golden/${name}`, import.meta.url), 'utf8');

  it('a config matching nothing leaves every format byte-identical to the golden files', () => {
    const before = ['markdown', 'json', 'sarif'].map((f) => cli(['--format', f], fixture.dir));
    writeConfig(fixture, { version: 1, sensitivePaths: ['nothing/matches/**'] });
    const after = ['markdown', 'json', 'sarif'].map((f) => cli(['--format', f], fixture.dir));
    expect(after).toEqual(before);
    expect(after[0]?.stdout).toBe(golden('report.md'));
    expect(after[1]?.stdout).toBe(golden('report.json'));
    expect(after[2]?.stdout).toBe(golden('report.sarif.json'));
  });
});
