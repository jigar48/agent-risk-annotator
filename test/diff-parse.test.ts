import { describe, expect, it } from 'vitest';
import { parseDiff } from '../src/diff/parse.js';

const d = (...ls: string[]) => ls.join('\n') + '\n';

describe('parseDiff', () => {
  it('returns [] for empty input', () => {
    expect(parseDiff('')).toEqual([]);
  });

  it('parses a modified file with several hunks', () => {
    const [f] = parseDiff(
      d(
        'diff --git a/src/app.ts b/src/app.ts',
        'index 1111111..2222222 100644',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -3,2 +3,3 @@ function main() {',
        '-old a',
        '-old b',
        '+new a',
        '+new b',
        '+new c',
        '@@ -20,0 +21,2 @@',
        '+inserted 1',
        '+inserted 2',
      ),
    );
    expect(f).toMatchObject({
      path: 'src/app.ts',
      oldPath: null,
      status: 'modified',
      isBinary: false,
    });
    expect(f?.hunks).toHaveLength(2);
    expect(f?.hunks[0]).toMatchObject({
      start: 3,
      end: 5,
      removed: ['old a', 'old b'],
      added: ['new a', 'new b', 'new c'],
    });
    expect(f?.hunks[1]).toMatchObject({
      start: 21,
      end: 22,
      oldLines: 0,
      added: ['inserted 1', 'inserted 2'],
    });
  });

  it('treats an omitted count as 1', () => {
    const [f] = parseDiff(d('diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -7 +7 @@', '-a', '+b'));
    expect(f?.hunks[0]).toMatchObject({ oldLines: 1, newLines: 1, start: 7, end: 7 });
  });

  it('collapses a pure deletion to the line it sits after', () => {
    const [f] = parseDiff(
      d('diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -10,3 +9,0 @@', '-a', '-b', '-c'),
    );
    expect(f?.hunks[0]).toMatchObject({ start: 9, end: 9, added: [], removed: ['a', 'b', 'c'] });
  });

  it('uses line 1 for a deletion at the top of the file', () => {
    const [f] = parseDiff(
      d('diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,2 +0,0 @@', '-a', '-b'),
    );
    expect(f?.hunks[0]).toMatchObject({ start: 1, end: 1 });
  });

  it('does not mistake removed lines starting with "--" for a file header', () => {
    const [f] = parseDiff(
      d(
        'diff --git a/q.sql b/q.sql',
        '--- a/q.sql',
        '+++ b/q.sql',
        '@@ -1,2 +1,1 @@',
        '--- drop guard',
        '-++ weird',
        '+select 1;',
      ),
    );
    expect(f?.path).toBe('q.sql');
    expect(f?.hunks[0]?.removed).toEqual(['-- drop guard', '++ weird']);
    expect(f?.hunks[0]?.added).toEqual(['select 1;']);
  });

  it('parses an added file', () => {
    const [f] = parseDiff(
      d(
        'diff --git a/new.ts b/new.ts',
        'new file mode 100644',
        'index 0000000..3333333',
        '--- /dev/null',
        '+++ b/new.ts',
        '@@ -0,0 +1,2 @@',
        '+a',
        '+b',
      ),
    );
    expect(f).toMatchObject({ path: 'new.ts', oldPath: null, status: 'added' });
    expect(f?.hunks[0]).toMatchObject({ start: 1, end: 2 });
  });

  it('parses a deleted file, keeping its old path', () => {
    const [f] = parseDiff(
      d(
        'diff --git a/gone.test.ts b/gone.test.ts',
        'deleted file mode 100644',
        '--- a/gone.test.ts',
        '+++ /dev/null',
        '@@ -1,2 +0,0 @@',
        '-a',
        '-b',
      ),
    );
    expect(f).toMatchObject({ path: 'gone.test.ts', oldPath: null, status: 'deleted' });
    expect(f?.hunks[0]).toMatchObject({ start: 1, end: 1, removed: ['a', 'b'] });
  });

  it('parses a rename with edits', () => {
    const [f] = parseDiff(
      d(
        'diff --git a/old/name.ts b/new/name.ts',
        'similarity index 90%',
        'rename from old/name.ts',
        'rename to new/name.ts',
        '--- a/old/name.ts',
        '+++ b/new/name.ts',
        '@@ -1 +1 @@',
        '-a',
        '+b',
      ),
    );
    expect(f).toMatchObject({ path: 'new/name.ts', oldPath: 'old/name.ts', status: 'renamed' });
    expect(f?.hunks).toHaveLength(1);
  });

  it('parses a pure rename with no hunks', () => {
    const [f] = parseDiff(
      d('diff --git a/a.ts b/b.ts', 'similarity index 100%', 'rename from a.ts', 'rename to b.ts'),
    );
    expect(f).toMatchObject({ path: 'b.ts', oldPath: 'a.ts', status: 'renamed', hunks: [] });
  });

  it('flags binary files', () => {
    const [f] = parseDiff(
      d(
        'diff --git a/logo.png b/logo.png',
        'index 1..2 100644',
        'Binary files a/logo.png and b/logo.png differ',
      ),
    );
    expect(f).toMatchObject({ path: 'logo.png', isBinary: true, hunks: [] });
  });

  it('handles mode-only changes and paths with spaces', () => {
    const [f] = parseDiff(
      d('diff --git a/my dir/run.sh b/my dir/run.sh', 'old mode 100644', 'new mode 100755'),
    );
    expect(f).toMatchObject({ path: 'my dir/run.sh', status: 'modified', hunks: [] });
  });

  it('decodes C-quoted paths, including octal UTF-8 escapes', () => {
    const [f] = parseDiff(
      d(
        'diff --git "a/caf\\303\\251 \\"x\\".ts" "b/caf\\303\\251 \\"x\\".ts"',
        '--- "a/caf\\303\\251 \\"x\\".ts"',
        '+++ "b/caf\\303\\251 \\"x\\".ts"',
        '@@ -1 +1 @@',
        '-a',
        '+b',
      ),
    );
    expect(f?.path).toBe('café "x".ts');
  });

  it('ignores "no newline" markers and strips CRLF', () => {
    const [f] = parseDiff(
      [
        'diff --git a/w.txt b/w.txt',
        '--- a/w.txt',
        '+++ b/w.txt',
        '@@ -1 +1 @@',
        '-old',
        '\\ No newline at end of file',
        '+new',
        '\\ No newline at end of file',
        '',
      ].join('\r\n'),
    );
    expect(f?.hunks[0]).toMatchObject({ removed: ['old'], added: ['new'] });
  });

  it('tolerates context lines (non -U0 diffs)', () => {
    const [f] = parseDiff(
      d(
        'diff --git a/x b/x',
        '--- a/x',
        '+++ b/x',
        '@@ -1,3 +1,3 @@',
        ' keep',
        '-a',
        '+b',
        ' keep',
      ),
    );
    expect(f?.hunks[0]).toMatchObject({ start: 1, end: 3, added: ['b'], removed: ['a'] });
  });

  it('parses multiple files in sequence', () => {
    const files = parseDiff(
      d(
        'diff --git a/one b/one',
        '--- a/one',
        '+++ b/one',
        '@@ -1 +1 @@',
        '-a',
        '+b',
        'diff --git a/two b/two',
        '--- a/two',
        '+++ b/two',
        '@@ -2,0 +3 @@',
        '+c',
      ),
    );
    expect(files.map((f) => f.path)).toEqual(['one', 'two']);
    expect(files[1]?.hunks[0]).toMatchObject({ start: 3, end: 3 });
  });
});
