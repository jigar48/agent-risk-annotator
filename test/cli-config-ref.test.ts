import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Log } from 'sarif';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CONFIG_FILE,
  MAX_CONFIG_BYTES,
  loadConfigFromRef,
  validateConfigRef,
} from '../src/config.js';
import { buildContext } from '../src/context.js';
import { EXIT_ERROR, EXIT_FAIL_ON, EXIT_OK, HELP, main } from '../src/main.js';
import { createRepo, lines, type TestRepo } from './helpers/repo.js';

function cli(args: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = main(args, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

interface JsonReport {
  files: { path: string; hunks: { level: string; rule: string; reason: string }[] }[];
}
const report = (stdout: string) => JSON.parse(stdout) as JsonReport;
const reasons = (stdout: string) =>
  Object.fromEntries(report(stdout).files.map((f) => [f.path, f.hunks.map((h) => h.reason)]));

const config = (paths: string[]) =>
  JSON.stringify({ version: 1, sensitivePaths: paths }, null, 2) + '\n';

const repos: TestRepo[] = [];
afterAll(() => repos.forEach((r) => r.cleanup()));
function newRepo(): TestRepo {
  const r = createRepo();
  repos.push(r);
  return r;
}

/** Writes `content` as a loose blob object and returns its id. */
function hashBlob(repo: TestRepo, content: string | Uint8Array): string {
  return execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: repo.dir,
    input: content,
    encoding: 'utf8',
  }).trim();
}

/** A commit whose root tree is exactly `entries` ("<mode> <type> <oid>\t<name>" lines). */
function commitWithTree(repo: TestRepo, entries: string[], parent?: string): string {
  const tree = execFileSync('git', ['mktree'], {
    cwd: repo.dir,
    input: entries.join('\n') + '\n',
    encoding: 'utf8',
  }).trim();
  const args = ['commit-tree', tree, '-m', 'synthetic', ...(parent ? ['-p', parent] : [])];
  return repo.git(...args).trim();
}

/**
 * The scenario --config-ref exists for. `base` (main) protects src/payments/** in its
 * committed config. The PR commit removes that pattern and changes a payment file in the
 * same change, plus an ordinary catalog file.
 */
let shop: TestRepo;
let baseSha: string;
let prSha: string;
beforeAll(() => {
  shop = newRepo();
  shop.write('src/payments/charge.ts', lines(5));
  shop.write('src/catalog/list.ts', lines(5));
  shop.write(CONFIG_FILE, config(['src/payments/**']));
  baseSha = shop.commit('chore: protect payments');
  shop.write('src/payments/charge.ts', lines(5).replace('line 2\n', 'line 2 skip idempotency\n'));
  shop.write('src/catalog/list.ts', lines(5).replace('line 4\n', 'line 4 sort\n'));
  shop.write(CONFIG_FILE, config([]));
  prSha = shop.commit('chore: tidy review config');
});

/** Restores the working tree to the PR commit after tests that dirty it. */
afterEach(() => {
  rmSync(join(shop.dir, CONFIG_FILE), { recursive: true, force: true });
  shop.git('checkout', '-q', '--', '.');
});

/** JSON reasons; Markdown appends the confidence, "(path heuristic)". */
const PAYMENT_HIGH = 'Matches project sensitive path `src/payments/**`; review with extra care';
const POLICY_HIGH =
  'Review-policy file `.riskannotate.json` changed; confirm sensitive-path coverage still matches intent';

describe('--config-ref: trusted configuration from a commit', () => {
  it('default behavior is unchanged: the PR working-tree config is used and payments slip by', () => {
    const r = cli(['--base', baseSha, '--format', 'json'], shop.dir);
    expect(r.code).toBe(EXIT_OK);
    expect(r.stderr).toBe('');
    expect(reasons(r.stdout)).toEqual({ [CONFIG_FILE]: [POLICY_HIGH] });
  });

  it('the trusted base config still flags the payment file the PR un-protected', () => {
    const r = cli(['--base', baseSha, '--config-ref', baseSha, '--format', 'json'], shop.dir);
    expect(r.code).toBe(EXIT_OK);
    expect(r.stderr).toBe('');
    expect(reasons(r.stdout)).toEqual({
      [CONFIG_FILE]: [POLICY_HIGH],
      'src/payments/charge.ts': [PAYMENT_HIGH],
    });
    const charge = report(r.stdout).files.find((f) => f.path === 'src/payments/charge.ts');
    expect(charge?.hunks.map((h) => `${h.rule}:${h.level}`)).toEqual(['E:HIGH']);
  });

  it('accepts branch names, relative expressions, short SHAs and annotated tags', () => {
    shop.git('tag', '-a', '-m', 'trusted', 'trusted-config', baseSha);
    shop.git('branch', '-f', 'trusted-branch', baseSha);
    try {
      const expected = cli(['--base', baseSha, '--config-ref', baseSha], shop.dir);
      for (const ref of ['HEAD~1', 'trusted-branch', 'trusted-config', baseSha.slice(0, 10)]) {
        expect(cli(['--base', baseSha, '--config-ref', ref], shop.dir)).toEqual(expected);
      }
      expect(cli(['--base', baseSha, `--config-ref=${baseSha}`], shop.dir)).toEqual(expected);
    } finally {
      shop.git('tag', '-d', 'trusted-config');
      shop.git('branch', '-D', 'trusted-branch');
    }
  });

  it('never reads, merges or falls back to the working-tree file', () => {
    const expected = cli(['--base', baseSha, '--config-ref', baseSha], shop.dir);
    // An extra pattern in the working tree is not merged in.
    shop.write(CONFIG_FILE, config(['src/catalog/**']));
    expect(cli(['--base', baseSha, '--config-ref', baseSha], shop.dir)).toEqual(expected);
    // A broken working-tree file is not even opened.
    shop.write(CONFIG_FILE, '{ broken');
    expect(cli(['--base', baseSha, '--config-ref', baseSha], shop.dir)).toEqual(expected);
    // Nor is a directory in its place, or no file at all.
    rmSync(join(shop.dir, CONFIG_FILE));
    mkdirSync(join(shop.dir, CONFIG_FILE));
    expect(cli(['--base', baseSha, '--config-ref', baseSha], shop.dir)).toEqual(expected);
    rmSync(join(shop.dir, CONFIG_FILE), { recursive: true });
    expect(cli(['--base', baseSha, '--config-ref', baseSha], shop.dir)).toEqual(expected);
  });

  it('keeps --base (the diff) and --config-ref (the config) independent', () => {
    // A third commit whose config protects only the catalog: the diff is still base...PR.
    const other = commitWithTree(
      shop,
      [`100644 blob ${hashBlob(shop, config(['src/catalog/**']))}\t${CONFIG_FILE}`],
      baseSha,
    );
    const r = cli(['--base', baseSha, '--config-ref', other, '--format', 'json'], shop.dir);
    expect(r.code).toBe(EXIT_OK);
    expect(Object.keys(reasons(r.stdout))).toEqual([CONFIG_FILE, 'src/catalog/list.ts']);
    // Without --base the default range (HEAD~1..HEAD) is used, with the same trusted config.
    // Here HEAD~1 is the base commit, so the same files are flagged under another range label.
    const noBase = cli(['--config-ref', baseSha], shop.dir);
    expect(noBase.stdout).toContain('`HEAD~1..HEAD`');
    expect(reasons(cli(['--config-ref', baseSha, '--format', 'json'], shop.dir).stdout)).toEqual(
      reasons(
        cli(['--base', baseSha, '--config-ref', baseSha, '--format', 'json'], shop.dir).stdout,
      ),
    );
    // --head picks the reviewed revision; the config still comes from --config-ref.
    const head = cli(['--head', prSha, '--config-ref', baseSha, '--format', 'json'], shop.dir);
    expect(Object.keys(reasons(head.stdout))).toContain('src/payments/charge.ts');
  });

  it('combines the trusted config with --sensitive-path flags', () => {
    const r = cli(
      ['--config-ref', baseSha, '--sensitive-path', 'src/catalog/**', '--format', 'json'],
      shop.dir,
    );
    expect(Object.keys(reasons(r.stdout))).toEqual([
      CONFIG_FILE,
      'src/catalog/list.ts',
      'src/payments/charge.ts',
    ]);
  });

  it('is byte-identical to passing the trusted patterns as flags, in every format', () => {
    // The PR's own committed config is empty, so flags alone reproduce the trusted set.
    for (const format of ['markdown', 'json', 'sarif']) {
      const viaRef = cli(['--config-ref', baseSha, '--format', format], shop.dir);
      const viaFlags = cli(['--sensitive-path', 'src/payments/**', '--format', format], shop.dir);
      expect(viaRef).toEqual(viaFlags);
      const runs = [1, 2, 3].map(() =>
        cli(['--config-ref', baseSha, '--format', format], shop.dir),
      );
      expect(new Set(runs.map((x) => x.stdout)).size).toBe(1);
    }
    const log = JSON.parse(
      cli(['--config-ref', baseSha, '--format', 'sarif'], shop.dir).stdout,
    ) as Log;
    const results = log.runs[0]?.results ?? [];
    expect(
      results.map((r) => [
        r.ruleId,
        r.level,
        r.locations?.[0]?.physicalLocation?.artifactLocation?.uri,
      ]),
    ).toEqual([
      ['RA-E', 'error', CONFIG_FILE],
      ['RA-E', 'error', 'src/payments/charge.ts'],
    ]);
  });

  it('keeps exit code semantics: 2 on --fail-on, 0 below it, 1 on errors', () => {
    const hit = cli(['--config-ref', baseSha, '--fail-on', 'high'], shop.dir);
    expect(hit.code).toBe(EXIT_FAIL_ON);
    expect(hit.stdout).toContain(`${PAYMENT_HIGH} (path heuristic)`); // the report is still printed
    expect(hit.stderr).toBe('risk-annotate: found annotations at or above HIGH\n');
    // A catalog-only change under the same kind of trusted config: nothing at HIGH.
    const repo = newRepo();
    repo.write('src/payments/charge.ts', lines(3));
    repo.write('src/catalog/list.ts', lines(3));
    repo.write(CONFIG_FILE, config(['src/payments/**']));
    repo.commit('base');
    repo.write('src/catalog/list.ts', lines(3).replace('line 1\n', 'line 1 x\n'));
    repo.commit('catalog');
    expect(cli(['--config-ref', 'HEAD~1', '--fail-on', 'high'], repo.dir).code).toBe(EXIT_OK);
    expect(cli(['--config-ref', 'no-such-ref', '--fail-on', 'high'], shop.dir).code).toBe(
      EXIT_ERROR,
    );
  });

  it('finds the config at the repository root when run from a nested directory', () => {
    const nested = join(shop.dir, 'src', 'payments');
    const expected = cli(['--config-ref', baseSha], shop.dir);
    expect(cli(['--config-ref', baseSha], nested)).toEqual(expected);
    expect(cli(['--config-ref', baseSha, '--cwd', nested], shop.dir)).toEqual(expected);
    expect(buildContext({ cwd: nested, configRef: baseSha }).sensitivePaths).toEqual([
      'src/payments/**',
    ]);
  });

  it('runs no git hooks', () => {
    const marker = join(shop.dir, 'hook-ran');
    const hooks = join(shop.dir, '.git', 'hooks');
    for (const name of [
      'post-checkout',
      'reference-transaction',
      'pre-commit',
      'post-index-change',
    ]) {
      writeFileSync(join(hooks, name), `#!/bin/sh\necho ran > "${marker.replace(/\\/g, '/')}"\n`);
      chmodSync(join(hooks, name), 0o755);
    }
    try {
      expect(cli(['--config-ref', baseSha], shop.dir).code).toBe(EXIT_OK);
      expect(existsSync(marker)).toBe(false);
    } finally {
      for (const name of [
        'post-checkout',
        'reference-transaction',
        'pre-commit',
        'post-index-change',
      ]) {
        rmSync(join(hooks, name), { force: true });
      }
    }
  });

  it('documents the flag and its trust model in --help', () => {
    expect(HELP).toContain('--config-ref <commit-ish>');
    expect(HELP).toMatch(/does\s+not make a commit trustworthy/);
  });
});

describe('--config-ref fails closed', () => {
  const expectError = (args: string[], message: RegExp, cwd = shop.dir) => {
    for (const format of ['markdown', 'json', 'sarif']) {
      const r = cli([...args, '--format', format], cwd);
      expect(r.code).toBe(EXIT_ERROR);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^risk-annotate: /);
      expect(r.stderr).toMatch(message);
    }
  };

  it('rejects a commit without .riskannotate.json instead of using no config', () => {
    const bare = commitWithTree(shop, [
      `100644 blob ${hashBlob(shop, 'x\n')}\tREADME.md`,
      // Exact, case-sensitive name only; a look-alike does not count.
      `100644 blob ${hashBlob(shop, config(['src/payments/**']))}\t.RiskAnnotate.json`,
    ]);
    expectError(
      ['--config-ref', bare],
      /\.riskannotate\.json: not found at the repository root in --config-ref "[0-9a-f]+" \([0-9a-f]{12}\)/,
    );
    // Only the root counts: a nested copy is ignored.
    const nested = commitWithTree(shop, [
      `040000 tree ${shop.git('rev-parse', `${baseSha}^{tree}`).trim()}\tsub`,
    ]);
    expectError(['--config-ref', nested], /not found at the repository root/);
  });

  it.each([
    ['no-such-ref', /--config-ref "no-such-ref": unknown revision; fetch the trusted commit first/],
    ['0000000000000000000000000000000000000000', /unknown revision/],
    ['HEAD~99', /unknown revision/],
    ['main..HEAD', /unknown revision/],
  ])('rejects the unknown ref %s', (ref, message) => {
    expectError(['--config-ref', ref], message);
  });

  it('rejects refs that name a tree or a blob', () => {
    const tree = shop.git('rev-parse', `${baseSha}^{tree}`).trim();
    const blob = shop.git('rev-parse', `${baseSha}:${CONFIG_FILE}`).trim();
    expectError(['--config-ref', tree], /names a tree, not a commit/);
    expectError(['--config-ref', blob], /names a blob, not a commit/);
    expectError(['--config-ref', `${baseSha}:${CONFIG_FILE}`], /names a blob, not a commit/);
  });

  it.each([
    ['', /--config-ref must not be empty/],
    ['-c', /must not start with "-"/],
    ['--output=/tmp/x', /must not start with "-"/],
    ['main\u001b[2J', /control and bidirectional characters are not allowed/],
    ['main‮', /control and bidirectional characters are not allowed/],
    ['main branch', /whitespace/],
    ['a'.repeat(257), /at most 256 characters/],
  ])('rejects the malformed ref %j before running git', (ref, message) => {
    const r = cli([`--config-ref=${ref}`], shop.dir);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(message);
    expect(r.stderr).not.toContain('\u001b');
    expect(r.stderr).not.toContain('‮');
    expect(r.stderr).toContain('Run "risk-annotate --help" for usage.');
    expect(validateConfigRef(ref)).not.toBeNull();
    expect(() => loadConfigFromRef(shop.dir, ref)).toThrow(message);
  });

  it('requires a value', () => {
    const r = cli(['--config-ref'], shop.dir);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.stderr).toMatch(/--config-ref/);
  });

  it('rejects a symlink, directory or submodule in place of the config', () => {
    const target = hashBlob(shop, 'elsewhere.json');
    const symlink = commitWithTree(shop, [`120000 blob ${target}\t${CONFIG_FILE}`]);
    expectError(['--config-ref', symlink], /is a symbolic link in --config-ref/);
    const dir = commitWithTree(shop, [
      `040000 tree ${shop.git('rev-parse', `${baseSha}^{tree}`).trim()}\t${CONFIG_FILE}`,
    ]);
    expectError(
      ['--config-ref', dir],
      /is not a regular file in --config-ref .* \(tree, mode 040000\)/,
    );
    const gitlink = commitWithTree(shop, [`160000 commit ${baseSha}\t${CONFIG_FILE}`]);
    expectError(
      ['--config-ref', gitlink],
      /is not a regular file in --config-ref .* \(commit, mode 160000\)/,
    );
  });

  it('accepts an executable-bit config, like the working-tree loader', () => {
    const exec = commitWithTree(shop, [
      `100755 blob ${hashBlob(shop, config(['src/payments/**']))}\t${CONFIG_FILE}`,
    ]);
    expect(cli(['--config-ref', exec], shop.dir)).toEqual(cli(['--config-ref', baseSha], shop.dir));
  });

  it('enforces the 32 KiB limit before reading the blob', () => {
    const body = config(['src/payments/**']);
    const exact = body.replace(/\n$/, ' '.repeat(MAX_CONFIG_BYTES - body.length) + '\n');
    expect(Buffer.byteLength(exact)).toBe(MAX_CONFIG_BYTES);
    const ok = commitWithTree(shop, [`100644 blob ${hashBlob(shop, exact)}\t${CONFIG_FILE}`]);
    expect(cli(['--config-ref', ok], shop.dir).code).toBe(EXIT_OK);
    const big = commitWithTree(shop, [
      `100644 blob ${hashBlob(shop, exact + ' ')}\t${CONFIG_FILE}`,
    ]);
    expectError(
      ['--config-ref', big],
      /file is larger than 32 KiB \(32769 bytes or more\) \(in --config-ref/,
    );
    const huge = commitWithTree(shop, [
      `100644 blob ${hashBlob(shop, ' '.repeat(4 * 1024 * 1024))}\t${CONFIG_FILE}`,
    ]);
    expectError(['--config-ref', huge], /file is larger than 32 KiB \(4194304 bytes or more\)/);
  });

  it.each([
    [
      '{ "version": 1, ',
      /\.riskannotate\.json: invalid JSON.* \(in --config-ref "[0-9a-f]+" \([0-9a-f]{12}\)\)/,
    ],
    [config(['../etc/**']), /sensitivePaths\[0\] "\.\.\/etc\/\*\*": "\.\." segments/],
    [JSON.stringify({ version: 2 }), /unsupported version 2/],
    [JSON.stringify({ version: 1, ignore: ['src/**'] }), /unknown property "ignore"/],
    ['{"version":1,"__proto__":{"sensitivePaths":[]}}', /unknown property "__proto__"/],
    ['[]', /must contain a JSON object/],
    ['', /invalid JSON/],
  ])('reuses the strict parser for a malformed committed config: %j', (content, message) => {
    const bad = commitWithTree(shop, [`100644 blob ${hashBlob(shop, content)}\t${CONFIG_FILE}`]);
    expectError(['--config-ref', bad], message);
  });

  it('rejects invalid UTF-8 in the committed config', () => {
    const bytes = Uint8Array.from([
      ...Buffer.from('{"version":1,"sensitivePaths":["a'),
      0xff,
      ...Buffer.from('"]}'),
    ]);
    const bad = commitWithTree(shop, [`100644 blob ${hashBlob(shop, bytes)}\t${CONFIG_FILE}`]);
    expectError(['--config-ref', bad], /is not valid UTF-8 \(in --config-ref/);
  });

  it('fails closed when the config object is missing from the object store', () => {
    const repo = newRepo();
    repo.write('src/payments/charge.ts', lines(3));
    repo.write(CONFIG_FILE, config(['src/payments/**']));
    const sha = repo.commit('base');
    repo.write('src/payments/charge.ts', lines(3).replace('line 1\n', 'line 1 x\n'));
    repo.commit('change');
    const oid = repo.git('rev-parse', `${sha}:${CONFIG_FILE}`).trim();
    const loose = join(repo.dir, '.git', 'objects', oid.slice(0, 2), oid.slice(2));
    chmodSync(loose, 0o644);
    rmSync(loose);
    // The working tree still has a valid copy; it must not be used as a fallback.
    expectError(
      ['--config-ref', sha],
      /\.riskannotate\.json: cannot read from --config-ref/,
      repo.dir,
    );
  });

  it('fails closed in a shallow clone whose history lacks the trusted commit', () => {
    const origin = newRepo();
    origin.write('src/payments/charge.ts', lines(3));
    origin.write(CONFIG_FILE, config(['src/payments/**']));
    origin.commit('base');
    origin.write('src/payments/charge.ts', lines(3).replace('line 1\n', 'line 1 x\n'));
    origin.write(CONFIG_FILE, config([]));
    origin.commit('pr');
    const clone = newRepo();
    rmSync(clone.dir, { recursive: true, force: true });
    execFileSync('git', [
      'clone',
      '-q',
      '--depth',
      '1',
      `file://${origin.dir.replace(/\\/g, '/')}`,
      clone.dir,
    ]);
    expect(clone.git('rev-parse', '--is-shallow-repository').trim()).toBe('true');
    expectError(
      ['--config-ref', 'HEAD~1'],
      /unknown revision; fetch the trusted commit first/,
      clone.dir,
    );
    const missingSha = origin.git('rev-parse', 'HEAD~1').trim();
    expectError(['--config-ref', missingSha], /unknown revision/, clone.dir);
    // The commit that is present still works, and its (empty) config is used as committed.
    expect(cli(['--config-ref', 'HEAD'], clone.dir).code).toBe(EXIT_OK);
  });

  it('reports a git failure as an error, not as an empty config, outside a repository', () => {
    const outside = newRepo();
    rmSync(join(outside.dir, '.git'), { recursive: true, force: true });
    const r = cli(['--config-ref', 'HEAD'], outside.dir);
    expect(r.code).toBe(EXIT_ERROR);
    expect(r.stdout).toBe('');
  });
});
