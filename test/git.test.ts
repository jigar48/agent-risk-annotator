import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDiff } from '../src/diff/parse.js';
import { EMPTY_TREE, GitError, assertRepo, getDiff, resolveRange } from '../src/git.js';
import { createRepo, lines, type TestRepo } from './helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

const diffFiles = (opts: { base?: string; head?: string } = {}) =>
  parseDiff(getDiff(resolveRange(opts, repo.dir), repo.dir));

describe('resolveRange', () => {
  it('defaults to HEAD~1..HEAD', () => {
    repo = createRepo();
    repo.write('a.txt', 'one\n');
    repo.commit('first');
    repo.write('a.txt', 'two\n');
    repo.commit('second');
    expect(resolveRange({}, repo.dir)).toEqual({ base: 'HEAD~1', head: 'HEAD', threeDot: false });
  });

  it('falls back to the empty tree on a root commit', () => {
    repo = createRepo();
    repo.write('src/index.ts', lines(3));
    repo.write('README.md', 'hi\n');
    repo.commit('root');

    expect(resolveRange({}, repo.dir)).toEqual({ base: EMPTY_TREE, head: 'HEAD', threeDot: false });

    const files = diffFiles();
    expect(files.map((f) => f.path).sort()).toEqual(['README.md', 'src/index.ts']);
    const idx = files.find((f) => f.path === 'src/index.ts');
    expect(idx).toMatchObject({ status: 'added' });
    expect(idx?.hunks).toEqual([
      expect.objectContaining({ start: 1, end: 3, added: ['line 1', 'line 2', 'line 3'] }),
    ]);
  });

  it('uses base...head when a base is given', () => {
    repo = createRepo();
    repo.write('a.txt', 'base\n');
    repo.commit('base');
    repo.git('checkout', '-q', '-b', 'feature');
    repo.write('feature.txt', 'feat\n');
    repo.commit('feature work');
    repo.git('checkout', '-q', 'main');
    repo.write('main-only.txt', 'main\n');
    repo.commit('main moved on');

    const range = resolveRange({ base: 'main', head: 'feature' }, repo.dir);
    expect(range).toEqual({ base: 'main', head: 'feature', threeDot: true });
    // Three-dot: only what feature added since the merge base, not main's later commit.
    expect(diffFiles({ base: 'main', head: 'feature' }).map((f) => f.path)).toEqual([
      'feature.txt',
    ]);
  });

  it('rejects unknown revisions with a GitError', () => {
    repo = createRepo();
    repo.write('a.txt', 'x\n');
    repo.commit('only');
    expect(() => resolveRange({ base: 'nope' }, repo.dir)).toThrow(GitError);
    expect(() => resolveRange({ head: 'nope' }, repo.dir)).toThrow(/unknown revision: nope/);
  });

  it('fails clearly outside a repository', () => {
    const plain = mkdtempSync(join(tmpdir(), 'risk-annotate-plain-'));
    try {
      expect(() => assertRepo(plain)).toThrow(/not a git repository/);
      expect(() => assertRepo(plain + '-missing')).toThrow(/directory not found/);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe('getDiff + parseDiff on real repos', () => {
  it('reports exact new-file line ranges', () => {
    repo = createRepo();
    repo.write('f.ts', lines(10));
    repo.commit('init');
    repo.write(
      'f.ts',
      lines(10)
        .replace('line 4\n', 'changed 4\n')
        .replace('line 9\n', 'line 9\nadded a\nadded b\n'),
    );
    repo.commit('edit');

    const [f] = diffFiles();
    expect(f?.hunks.map((h) => [h.start, h.end])).toEqual([
      [4, 4],
      [10, 11],
    ]);
  });

  it('detects renames', () => {
    repo = createRepo();
    repo.write('old/name.ts', lines(20));
    repo.commit('init');
    repo.write('new/name.ts', lines(20));
    repo.remove('old/name.ts');
    repo.commit('move');

    const [f] = diffFiles();
    expect(f).toMatchObject({
      path: 'new/name.ts',
      oldPath: 'old/name.ts',
      status: 'renamed',
      hunks: [],
    });
  });

  it('reports deleted test files with their removed lines', () => {
    repo = createRepo();
    repo.write('a.test.ts', lines(2, 'it'));
    repo.write('keep.ts', 'x\n');
    repo.commit('init');
    repo.remove('a.test.ts');
    repo.commit('drop test');

    const [f] = diffFiles();
    expect(f).toMatchObject({ path: 'a.test.ts', status: 'deleted' });
    expect(f?.hunks[0]?.removed).toEqual(['it 1', 'it 2']);
  });

  it('ignores user config that changes diff prefixes or path quoting', () => {
    repo = createRepo();
    repo.git('config', 'diff.noprefix', 'true');
    repo.git('config', 'diff.mnemonicPrefix', 'true');
    repo.git('config', 'core.quotePath', 'true');
    repo.write('café dir/a b.ts', 'x\n');
    repo.commit('init');
    repo.write('café dir/a b.ts', 'y\n');
    repo.commit('edit');

    const [f] = diffFiles();
    expect(f?.path).toBe('café dir/a b.ts');
    expect(f?.hunks[0]).toMatchObject({ start: 1, end: 1, removed: ['x'], added: ['y'] });
  });

  it('marks binary files', () => {
    repo = createRepo();
    repo.write('img.bin', 'a\0b');
    repo.commit('init');
    repo.write('img.bin', 'a\0c');
    repo.commit('edit');
    expect(diffFiles()[0]).toMatchObject({ path: 'img.bin', isBinary: true, hunks: [] });
  });
});
