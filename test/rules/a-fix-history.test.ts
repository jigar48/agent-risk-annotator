import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/context.js';
import { ruleA } from '../../src/rules/a-fix-history.js';
import { annotate } from '../../src/rules/engine.js';
import { createRepo, type TestRepo } from '../helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

const signals = () =>
  Object.fromEntries(
    annotate(buildContext({ cwd: repo.dir }), [ruleA]).map((f) => [
      f.path,
      f.hunks.map((h) => ({ level: h.top.level, reason: h.top.reason, ev: h.top.evidence })),
    ]),
  );

function base() {
  repo = createRepo();
  repo.write('a.ts', '1\n');
  repo.write('b.ts', '1\n');
  repo.commit('init');
}

describe('Rule A — fix-prone files', () => {
  it('flags files touched by a fix commit in the window, as HIGH from git log', () => {
    base();
    const fix = repo.commit.call(null, 'noop'); // placeholder so hashes differ
    void fix;
    repo.write('a.ts', '2\n');
    const hash = repo.commit('fix: null check in a');
    repo.write('a.ts', '3\n');
    repo.write('b.ts', '2\n');
    repo.commit('feat: agent change');

    const s = signals();
    expect(Object.keys(s)).toEqual(['a.ts']);
    expect(s['a.ts']).toEqual([
      {
        level: 'HIGH',
        ev: 'git log',
        reason: `File was in fix/revert commit ${hash.slice(0, 7)} within the last 3 commits; it has regressed before`,
      },
    ]);
  });

  it.each(['Hotfix prod outage', 'Revert "feat: x"', 'INCIDENT-42 follow-up', 'bug in parser'])(
    'matches subject %j case-insensitively',
    (subject) => {
      base();
      repo.write('a.ts', '2\n');
      repo.commit(subject);
      repo.write('a.ts', '3\n');
      repo.commit('change');
      expect(signals()['a.ts']).toHaveLength(1);
    },
  );

  it('counts multiple fix commits and names the latest', () => {
    base();
    repo.write('a.ts', '2\n');
    repo.commit('fix: one');
    repo.write('a.ts', '3\n');
    const latest = repo.commit('fix: two');
    repo.write('a.ts', '4\n');
    repo.commit('change');
    expect(signals()['a.ts']?.[0]?.reason).toBe(
      `File was in 2 fix/revert commits within the last 3 (latest ${latest.slice(0, 7)}); it has regressed before`,
    );
  });

  it('ignores the commit under review even if its subject says fix', () => {
    base();
    repo.write('a.ts', '2\n');
    repo.commit('fix: agent says it fixed everything');
    expect(signals()).toEqual({});
  });

  it('matches a renamed file by its old path', () => {
    base();
    repo.write('a.ts', '2\n');
    repo.commit('fix: a');
    repo.remove('a.ts');
    repo.write('renamed.ts', '2\n');
    repo.commit('move');
    expect(Object.keys(signals())).toEqual(['renamed.ts']);
  });

  it('only looks back 30 commits', () => {
    base();
    repo.write('a.ts', '2\n');
    repo.commit('fix: long ago');
    for (let i = 0; i < 30; i++) repo.commit(`chore ${i}`);
    repo.write('a.ts', '3\n');
    repo.commit('change');
    expect(signals()).toEqual({});
  });
});
