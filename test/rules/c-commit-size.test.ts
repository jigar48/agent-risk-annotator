import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/context.js';
import { median, ruleC } from '../../src/rules/c-commit-size.js';
import { annotate } from '../../src/rules/engine.js';
import { createRepo, lines, type TestRepo } from '../helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

const ME = { name: 'Test User', email: 'test@example.invalid' };
const OTHER = { name: 'Test User', email: 'someone-else@example.invalid' };

const run = () => annotate(buildContext({ cwd: repo.dir }), [ruleC]);

/** `count` commits by `author`, each adding `size` lines to its own file. */
function history(count: number, size: number, author = ME, tag = 'h') {
  for (let i = 0; i < count; i++) {
    repo.write(`${tag}${i}.txt`, lines(size));
    repo.commit(`${tag} ${i}`, author);
  }
}

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('Rule C — outsized diff', () => {
  it('flags a diff over 3x the author median, as LOW on the largest hunk only', () => {
    repo = createRepo();
    history(5, 10);
    repo.write('small.ts', lines(5));
    repo.write('big.ts', lines(40));
    repo.commit('agent change', ME);

    const out = run();
    expect(out.map((f) => [f.path, f.hunks.map((h) => [h.start, h.end, h.top.level])])).toEqual([
      ['big.ts', [[1, 40, 'LOW']]],
    ]);
    expect(out[0]?.hunks[0]?.top).toMatchObject({
      evidence: 'commit size',
      reason:
        "Diff is 45 lines, 4.5x this author's median of 10 over 5 commits; consider splitting",
    });
  });

  it('stays silent at or under 3x', () => {
    repo = createRepo();
    history(5, 10);
    repo.write('change.ts', lines(30));
    repo.commit('exactly 3x', ME);
    expect(run()).toEqual([]);
  });

  it('only samples the last 10 commits, excluding the commit under review', () => {
    repo = createRepo();
    history(5, 1000, ME, 'old'); // outside the 10-commit window
    history(10, 10);
    repo.write('change.ts', lines(31));
    repo.commit('change', ME);
    expect(run()).toHaveLength(1);
  });

  it('needs at least 3 prior commits by the author', () => {
    repo = createRepo();
    history(2, 1);
    repo.write('change.ts', lines(500));
    repo.commit('huge', ME);
    expect(run()).toEqual([]);
  });

  it('matches the author by email, not display name', () => {
    repo = createRepo();
    history(5, 1000, OTHER); // same name, different email: must not count
    history(3, 10, ME, 'mine');
    repo.write('change.ts', lines(40));
    repo.commit('change', ME);
    expect(run()[0]?.hunks[0]?.top.reason).toMatch(/median of 10 over 3 commits/);
  });

  it('is silent on a root commit', () => {
    repo = createRepo();
    repo.write('a.ts', lines(5000));
    repo.commit('root');
    expect(run()).toEqual([]);
  });
});
