/**
 * Glob matcher for repo-relative POSIX paths. It uses no regular expressions: matching is
 * bounded by pattern length × path length, so user-supplied patterns (`--sensitive-path`)
 * cannot trigger catastrophic backtracking.
 *
 * - `*` any run of non-slash chars, `?` one non-slash char
 * - `**` as a whole segment: zero or more directories at the start or middle (`**\/x`,
 *   `a/**\/b`), one or more at the end (`a/**`); inside a segment it acts like `*`
 * - `{a,b}` alternatives, non-nested (built-in patterns only; user patterns reject braces)
 * - a pattern without `/` matches the basename anywhere, like .gitignore (`*.pem`, `.env*`)
 */
interface Compiled {
  basename: boolean;
  /** One segment list per brace alternative. */
  alternatives: string[][];
}

const cache = new Map<string, Compiled>();

export function matchGlob(path: string, pattern: string): boolean {
  let c = cache.get(pattern);
  if (!c) {
    c = {
      basename: !pattern.includes('/'),
      alternatives: expandBraces(pattern).map((p) => p.split('/')),
    };
    cache.set(pattern, c);
  }
  const target = c.basename ? path.slice(path.lastIndexOf('/') + 1) : path;
  const segments = target.split('/');
  return c.alternatives.some((alt) => matchSegments(alt, segments));
}

export function matchAny(path: string, patterns: readonly string[]): string | undefined {
  return patterns.find((p) => matchGlob(path, p));
}

function expandBraces(p: string): string[] {
  const open = p.indexOf('{');
  const close = open === -1 ? -1 : p.indexOf('}', open);
  if (close === -1) return [p];
  const head = p.slice(0, open);
  const tail = p.slice(close + 1);
  return p
    .slice(open + 1, close)
    .split(',')
    .flatMap((alt) => expandBraces(head + alt + tail));
}

/** Segment-level match with memoisation: O(pattern segments × path segments²). */
function matchSegments(pat: readonly string[], path: readonly string[]): boolean {
  const memo = new Map<number, boolean>();
  const go = (i: number, j: number): boolean => {
    if (i === pat.length) return j === path.length;
    const key = i * (path.length + 1) + j;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let ok = false;
    if (pat[i] === '**') {
      if (i === pat.length - 1) {
        ok = path.length - j >= 1; // trailing `**` needs at least one segment below it
      } else {
        for (let k = j; k <= path.length && !ok; k++) ok = go(i + 1, k);
      }
    } else {
      ok = j < path.length && matchSegment(pat[i] as string, path[j] as string) && go(i + 1, j + 1);
    }
    memo.set(key, ok);
    return ok;
  };
  return go(0, 0);
}

/** `*` / `?` wildcard match within one segment; greedy with a single backtrack point. */
function matchSegment(p: string, s: string): boolean {
  let pi = 0;
  let si = 0;
  let star = -1;
  let mark = 0;
  while (si < s.length) {
    if (pi < p.length && p[pi] === '*') {
      star = pi++;
      mark = si;
    } else if (pi < p.length && (p[pi] === '?' || p[pi] === s[si])) {
      pi++;
      si++;
    } else if (star !== -1) {
      pi = star + 1;
      si = ++mark;
    } else {
      return false;
    }
  }
  while (pi < p.length && p[pi] === '*') pi++;
  return pi === p.length;
}
