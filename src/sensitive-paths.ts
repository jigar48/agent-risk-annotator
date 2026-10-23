/**
 * Validation and normalization for `--sensitive-path <glob>`.
 *
 * Patterns are only ever compared against repo-relative paths reported by `git diff`; they
 * are never passed to git, a shell, or the filesystem. Validation keeps them in the syntax
 * the matcher documents (`*`, `**`, `?`) and bounds their size.
 */
export const MAX_SENSITIVE_PATHS = 100;
export const MAX_PATTERN_LENGTH = 256;

export class PatternError extends Error {
  override name = 'PatternError';
}

/** Normalizes every pattern, then dedupes and sorts so flag order never changes output. */
export function normalizeSensitivePaths(raw: readonly string[]): string[] {
  if (raw.length > MAX_SENSITIVE_PATHS) {
    throw new PatternError(
      `at most ${MAX_SENSITIVE_PATHS} --sensitive-path patterns are allowed (got ${raw.length})`,
    );
  }
  return [...new Set(raw.map(normalizePattern))].sort();
}

export function normalizePattern(input: string): string {
  const fail = (why: string): never => {
    const shown = input.length > 80 ? `${input.slice(0, 79)}…` : input;
    // JSON.stringify escapes control characters, so the message can't inject terminal codes.
    throw new PatternError(`--sensitive-path ${JSON.stringify(shown)}: ${why}`);
  };

  if (input.length === 0 || input.trim() === '') fail('pattern is empty');
  if (input.length > MAX_PATTERN_LENGTH)
    fail(`pattern is longer than ${MAX_PATTERN_LENGTH} characters`);
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) fail('control characters are not allowed');
  }
  if (input !== input.trim()) fail('pattern has leading or trailing whitespace');

  // Windows-style separators are accepted and converted; git always reports "/".
  let p = input.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) {
    fail('must be relative to the repository root, not an absolute path');
  }
  while (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/\/{2,}/g, '/');
  if (p.endsWith('/')) p += '**'; // "src/payments/" means everything under it
  if (p === '' || p === '.') fail('pattern is empty');

  if (p.startsWith('!')) fail('negated patterns ("!") are not supported');
  for (const ch of ['[', ']', '{', '}']) {
    if (p.includes(ch)) {
      fail(
        `unsupported glob syntax "${ch}"; supported: *, ** and ? (repeat the flag for alternatives)`,
      );
    }
  }
  if (p.includes('`')) fail('backticks are not allowed');

  for (const seg of p.split('/')) {
    if (seg === '..')
      fail('".." segments are not allowed; patterns match paths inside the repository');
    if (seg === '.') fail('"." segments are not allowed');
    if (seg.includes('**') && seg !== '**') {
      fail('"**" must be a whole path segment, e.g. "src/**/*.ts"');
    }
  }
  return p;
}
