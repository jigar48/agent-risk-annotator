export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /**
   * Inclusive, 1-indexed range in the new file version — what annotations cite.
   * A pure deletion (`+n,0`) has no new lines, so it collapses to the line it sits after
   * (or line 1 when the deletion is at the top of the file, or the file was deleted).
   */
  start: number;
  end: number;
  added: string[];
  removed: string[];
}

export interface FileChange {
  /** POSIX path in the new version; the old path for deleted files. */
  path: string;
  /** Previous path for renames and copies, otherwise null. */
  oldPath: string | null;
  status: FileStatus;
  isBinary: boolean;
  hunks: Hunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parses `git diff` output (any context size, with a/ b/ prefixes) into per-file hunks. */
export function parseDiff(text: string): FileChange[] {
  const files: FileChange[] = [];
  let file: FileChange | null = null;
  let hunk: Hunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;

  for (const raw of text.split('\n')) {
    // CRLF content shows up as a trailing \r; it never matters for line numbers or rules.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    // Inside a hunk, the header counts say exactly how many body lines follow. Consuming by
    // count (not by prefix) keeps a removed line like "-- note" from reading as a "---" header.
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const tag = line[0];
      const body = line.slice(1);
      if (tag === '+') {
        hunk.added.push(body);
        newLeft--;
        continue;
      }
      if (tag === '-') {
        hunk.removed.push(body);
        oldLeft--;
        continue;
      }
      if (tag === ' ') {
        oldLeft--;
        newLeft--;
        continue;
      }
      if (tag === '\\') continue; // "\ No newline at end of file"
      // Anything else means the hunk was shorter than advertised; fall through and re-sync.
      hunk = null;
    }
    if (line.startsWith('\\')) continue;

    if (line.startsWith('diff --git ')) {
      const [oldP, newP] = parseGitHeaderPaths(line.slice('diff --git '.length));
      file = { path: newP, oldPath: oldP, status: 'modified', isBinary: false, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    const m = HUNK_HEADER.exec(line);
    if (m) {
      const oldStart = Number(m[1]);
      const oldLines = m[2] === undefined ? 1 : Number(m[2]);
      const newStart = Number(m[3]);
      const newLines = m[4] === undefined ? 1 : Number(m[4]);
      const start = newLines > 0 ? newStart : Math.max(newStart, 1);
      const end = newLines > 0 ? newStart + newLines - 1 : start;
      hunk = { oldStart, oldLines, newStart, newLines, start, end, added: [], removed: [] };
      file.hunks.push(hunk);
      oldLeft = oldLines;
      newLeft = newLines;
      continue;
    }

    if (line.startsWith('new file mode')) file.status = 'added';
    else if (line.startsWith('deleted file mode')) file.status = 'deleted';
    else if (line.startsWith('rename from ')) {
      file.status = 'renamed';
      file.oldPath = unquote(line.slice('rename from '.length));
    } else if (line.startsWith('rename to ')) file.path = unquote(line.slice('rename to '.length));
    else if (line.startsWith('copy from ')) {
      file.status = 'copied';
      file.oldPath = unquote(line.slice('copy from '.length));
    } else if (line.startsWith('copy to ')) file.path = unquote(line.slice('copy to '.length));
    else if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.isBinary = true;
    else if (line.startsWith('--- ')) {
      const p = stripPrefix(line.slice(4), 'a/');
      if (p !== null) file.oldPath = p;
    } else if (line.startsWith('+++ ')) {
      const p = stripPrefix(line.slice(4), 'b/');
      if (p !== null) file.path = p;
    }
  }

  for (const f of files) {
    if (f.status === 'deleted' && f.oldPath !== null) f.path = f.oldPath;
    if (f.status !== 'renamed' && f.status !== 'copied') f.oldPath = null;
  }
  return files;
}

/** `--- a/x` / `+++ b/x` path, or null for /dev/null. */
function stripPrefix(raw: string, prefix: string): string | null {
  const s = unquote(raw.endsWith('\t') ? raw.slice(0, -1) : raw);
  if (s === '/dev/null') return null;
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

/**
 * `a/<old> b/<new>` from the `diff --git` line. Only authoritative for binary and mode-only
 * changes — `---`/`+++`/rename lines override it when present, because unquoted paths
 * containing " b/" make this line ambiguous.
 */
function parseGitHeaderPaths(rest: string): [string, string] {
  if (rest.startsWith('"')) {
    const [first, after] = readQuoted(rest);
    const second = after.trimStart();
    return [
      trimAB(first, 'a/'),
      trimAB(second.startsWith('"') ? readQuoted(second)[0] : second, 'b/'),
    ];
  }
  // Same path on both sides (the common case): "a/P b/P" has length 2·|P| + 5.
  if ((rest.length - 5) % 2 === 0) {
    const p = rest.slice(2, 2 + (rest.length - 5) / 2);
    if (rest === `a/${p} b/${p}`) return [p, p];
  }
  const split = rest.indexOf(' b/');
  if (split === -1) return [trimAB(rest, 'a/'), trimAB(rest, 'a/')];
  const second = rest.slice(split + 1);
  return [
    trimAB(rest.slice(0, split), 'a/'),
    trimAB(second.startsWith('"') ? readQuoted(second)[0] : second, 'b/'),
  ];
}

function trimAB(s: string, prefix: string): string {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

function unquote(s: string): string {
  return s.startsWith('"') ? readQuoted(s)[0] : s;
}

const ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  f: 12,
  n: 10,
  r: 13,
  t: 9,
  v: 11,
  '"': 34,
  '\\': 92,
};

/** Decodes a git C-style quoted string (octal escapes are UTF-8 bytes). Returns [value, rest]. */
function readQuoted(s: string): [string, string] {
  const bytes: number[] = [];
  let i = 1;
  while (i < s.length && s[i] !== '"') {
    if (s[i] !== '\\') {
      const ch = String.fromCodePoint(s.codePointAt(i) as number);
      bytes.push(...Buffer.from(ch, 'utf8'));
      i += ch.length;
      continue;
    }
    const next = s[i + 1] ?? '';
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
      i += 4;
    } else {
      bytes.push(ESCAPES[next] ?? next.charCodeAt(0));
      i += 2;
    }
  }
  return [Buffer.from(bytes).toString('utf8'), s.slice(i + 1)];
}
