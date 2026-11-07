import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIT_FAIL_ON, EXIT_OK, main } from '../src/main.js';
import { createRepo, type TestRepo } from './helpers/repo.js';

/**
 * examples/config-ref-demo: a PR that removes `src/payments/**` from its own
 * .riskannotate.json and edits a payment file in the same change. The checked-in reports
 * must stay exactly what the CLI produces, before and after --config-ref.
 */
const EXAMPLE = join(import.meta.dirname, '..', 'examples', 'config-ref-demo');
const read = (...p: string[]) => readFileSync(join(EXAMPLE, ...p), 'utf8').replace(/\r\n/g, '\n');

function cli(args: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = main(args, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

function copyTree(repo: TestRepo, from: string) {
  const files = readdirSync(from, { recursive: true, encoding: 'utf8' })
    .filter((p) => statSync(join(from, p)).isFile())
    .map((p) => p.split(sep).join('/'))
    .sort();
  for (const p of files) repo.write(p, readFileSync(join(from, p), 'utf8').replace(/\r\n/g, '\n'));
}

/** main = the trusted base; the PR branch overlays fixture/pr in one commit. */
const repo = createRepo();
afterAll(() => repo.cleanup());
copyTree(repo, join(EXAMPLE, 'fixture', 'base'));
repo.commit('chore: protect payments');
repo.git('checkout', '-q', '-b', 'agent/tidy-config');
copyTree(repo, join(EXAMPLE, 'fixture', 'pr'));
repo.commit('chore: tidy review config');

describe('config-ref-demo', () => {
  it('before: the PR config is trusted, so the payment change is not flagged', () => {
    const r = cli(['--base', 'main', '--fail-on', 'high'], repo.dir);
    expect(r.stdout).toBe(read('expected', 'before.md'));
    expect(r.stdout).not.toContain('src/payments/charge.ts');
    // Only the built-in review-policy signal on the config file itself is HIGH.
    expect(r.code).toBe(EXIT_FAIL_ON);
  });

  it('after: --config-ref main flags the payment change HIGH from the trusted config', () => {
    const r = cli(['--base', 'main', '--config-ref', 'main', '--fail-on', 'high'], repo.dir);
    expect(r.code).toBe(EXIT_FAIL_ON);
    expect(r.stdout).toBe(read('expected', 'after.md'));
    expect(r.stdout).toContain(
      '- L7-7: [HIGH] Matches project sensitive path `src/payments/**`; review with extra care (path heuristic)',
    );
    expect(r.stderr).toBe('risk-annotate: found annotations at or above HIGH\n');
  });

  it('flags only the config file and the payment file, both HIGH under Rule E', () => {
    const json = JSON.parse(
      cli(['--base', 'main', '--config-ref', 'main', '--format', 'json'], repo.dir).stdout,
    ) as { files: { path: string; hunks: { level: string; rule: string }[] }[] };
    expect(json.files.map((f) => [f.path, f.hunks.map((h) => `${h.rule}:${h.level}`)])).toEqual([
      ['.riskannotate.json', ['E:HIGH']],
      ['src/payments/charge.ts', ['E:HIGH']],
    ]);
    expect(repo.git('diff', '--name-only', 'main...HEAD').trim().split('\n')).toHaveLength(3);
  });

  it('the PR config on its own is valid, so nothing else explains the difference', () => {
    expect(cli(['--base', 'main', '--config-ref', 'HEAD'], repo.dir)).toMatchObject({
      code: EXIT_OK,
      stdout: read('expected', 'before.md'),
    });
  });
});
