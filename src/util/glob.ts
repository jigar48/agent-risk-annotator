/**
 * Minimal glob matcher for repo-relative POSIX paths.
 *
 * - `*` any run of non-slash chars, `?` one non-slash char, `{a,b}` alternatives
 * - `**` as a whole segment spans zero or more directories (`**\/x`, `a/**`, `a/**\/b`)
 * - a pattern without `/` matches the basename anywhere, like .gitignore (`*.pem`, `.env*`)
 */
const cache = new Map<string, RegExp>();

export function matchGlob(path: string, pattern: string): boolean {
  let re = cache.get(pattern);
  if (!re) {
    re = new RegExp(`^${convert(pattern)}$`);
    cache.set(pattern, re);
  }
  const target = pattern.includes('/') ? path : path.slice(path.lastIndexOf('/') + 1);
  return re.test(target);
}

export function matchAny(path: string, patterns: readonly string[]): string | undefined {
  return patterns.find((p) => matchGlob(path, p));
}

function convert(p: string): string {
  let out = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i] as string;
    if (c === '*' && p[i + 1] === '*') {
      const segmentStart = i === 0 || p[i - 1] === '/';
      if (segmentStart && p[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 3;
      } else {
        out += '.*';
        i += 2;
      }
    } else if (c === '*') {
      out += '[^/]*';
      i++;
    } else if (c === '?') {
      out += '[^/]';
      i++;
    } else if (c === '{') {
      const close = p.indexOf('}', i);
      if (close === -1) {
        out += '\\{';
        i++;
        continue;
      }
      out += `(?:${p
        .slice(i + 1, close)
        .split(',')
        .map(convert)
        .join('|')})`;
      i = close + 1;
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  return out;
}
