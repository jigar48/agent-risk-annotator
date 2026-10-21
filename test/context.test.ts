import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HISTORY_DEPTH, buildContext } from '../src/context.js';
import { getLog } from '../src/git.js';
import { createRepo, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

describe('getLog', () => {
  it('returns hash, author email, subject and touched files, newest first', () => {
    repo = createRepo();
    repo.write('a.ts', '1\n');
    repo.write('b.ts', '1\n');
    repo.commit('first: two files');
    repo.write('a.ts', '2\n');
    repo.commit('fix: a bug', { name: 'Other', email: 'other@example.invalid' });

    const log = getLog('HEAD', 10, repo.dir);
    expect(log.map((c) => [c.subject, c.authorEmail, c.files])).toEqual([
      ['fix: a bug', 'other@example.invalid', ['a.ts']],
      ['first: two files', 'test@example.invalid', ['a.ts', 'b.ts']],
    ]);
    expect(log[0]?.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('respects the limit', () => {
    repo = createRepo();
    for (let i = 0; i < 5; i++) repo.commit(`c${i}`);
    expect(getLog('HEAD', 3, repo.dir).map((c) => c.subject)).toEqual(['c4', 'c3', 'c2']);
  });
});

describe('buildContext', () => {
  it('collects the diff and the history before the change, excluding the head commit', () => {
    repo = createRepo();
    repo.write('a.ts', '1\n');
    repo.commit('fix: earlier');
    repo.write('a.ts', '2\n');
    repo.commit('fix: under review');

    const ctx = buildContext({ cwd: repo.dir });
    expect(ctx.files.map((f) => f.path)).toEqual(['a.ts']);
    expect(ctx.history.map((c) => c.subject)).toEqual(['fix: earlier']);
    expect(ctx.coverage).toBeNull();
  });

  it('has empty history for a root commit', () => {
    repo = createRepo();
    repo.write('a.ts', '1\n');
    repo.commit('root');
    const ctx = buildContext({ cwd: repo.dir });
    expect(ctx.files).toHaveLength(1);
    expect(ctx.history).toEqual([]);
  });

  it('with --base, history starts at the merge base (feature commits excluded)', () => {
    repo = createRepo();
    repo.write('a.ts', '1\n');
    repo.commit('base');
    repo.git('checkout', '-q', '-b', 'feature');
    repo.write('a.ts', '2\n');
    repo.commit('feature 1');
    repo.write('b.ts', '1\n');
    repo.commit('feature 2');
    repo.git('checkout', '-q', 'main');
    repo.commit('main later');

    const ctx = buildContext({ cwd: repo.dir, base: 'main', head: 'feature' });
    expect(ctx.files.map((f) => f.path).sort()).toEqual(['a.ts', 'b.ts']);
    expect(ctx.history.map((c) => c.subject)).toEqual(['base']);
  });

  it(`caps history at ${HISTORY_DEPTH} commits`, () => {
    repo = createRepo();
    for (let i = 0; i < HISTORY_DEPTH + 5; i++) repo.commit(`c${i}`);
    expect(buildContext({ cwd: repo.dir }).history).toHaveLength(HISTORY_DEPTH);
  });

  it('works from a subdirectory and finds coverage at the repo root', () => {
    repo = createRepo();
    repo.write('src/a.ts', '1\n');
    repo.commit('init');
    repo.write('src/a.ts', '2\n');
    repo.write('coverage/lcov.info', 'SF:src/a.ts\nDA:1,0\nend_of_record\n');
    repo.commit('edit');
    mkdirSync(join(repo.dir, 'src', 'deep'), { recursive: true });

    const ctx = buildContext({ cwd: join(repo.dir, 'src', 'deep') });
    expect(ctx.files.map((f) => f.path).sort()).toEqual(['coverage/lcov.info', 'src/a.ts']);
    expect(ctx.coverage?.format).toBe('lcov');
    expect(ctx.coverage?.lookup('src/a.ts')?.lines.get(1)).toBe(0);
  });
});
