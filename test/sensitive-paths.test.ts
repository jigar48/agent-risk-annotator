import { describe, expect, it } from 'vitest';
import {
  MAX_PATTERN_LENGTH,
  MAX_SENSITIVE_PATHS,
  PatternError,
  normalizePattern,
  normalizeSensitivePaths,
} from '../src/sensitive-paths.js';

describe('normalizePattern', () => {
  it.each([
    ['src/payments/**', 'src/payments/**'],
    ['./src/payments/**', 'src/payments/**'],
    ['././src/x.ts', 'src/x.ts'],
    ['src/payments/', 'src/payments/**'],
    ['src//payments///x.ts', 'src/payments/x.ts'],
    ['src\\payments\\**', 'src/payments/**'],
    ['.\\app\\api\\**', 'app/api/**'],
    ['settings.py', 'settings.py'],
    ['**/webhooks/*.ts', '**/webhooks/*.ts'],
    ['app/?/x', 'app/?/x'],
    ['my dir/file name.txt', 'my dir/file name.txt'],
  ])('%j → %j', (input, expected) => {
    expect(normalizePattern(input)).toBe(expected);
  });

  it.each([
    ['', /pattern is empty/],
    ['   ', /pattern is empty/],
    ['./', /pattern is empty/],
    ['.', /pattern is empty/],
    [' src/x', /leading or trailing whitespace/],
    ['src/x ', /leading or trailing whitespace/],
    ['/etc/passwd', /not an absolute path/],
    ['C:\\repo\\src\\**', /not an absolute path/],
    ['c:/repo/x', /not an absolute path/],
    ['\\\\server\\share\\x', /not an absolute path/],
    ['../outside/**', /"\.\." segments are not allowed/],
    ['src/../../etc/**', /"\.\." segments are not allowed/],
    ['src/./x', /"\." segments are not allowed/],
    ['src/[ab].ts', /unsupported glob syntax "\["/],
    ['src/*.{ts,js}', /unsupported glob syntax "\{"/],
    ['!src/keep/**', /negated patterns/],
    ['src/a**b', /must be a whole path segment/],
    ['***/x', /must be a whole path segment/],
    ['src/`x`', /backticks are not allowed/],
    ['src/\u0000x', /control characters/],
    ['src/\u001b[31mx', /control characters/],
    ['x'.repeat(MAX_PATTERN_LENGTH + 1), /longer than 256 characters/],
  ])('rejects %j', (input, message) => {
    expect(() => normalizePattern(input)).toThrow(PatternError);
    expect(() => normalizePattern(input)).toThrow(message);
  });

  it('names the flag and quotes the input safely in errors', () => {
    expect(() => normalizePattern('../x')).toThrow(/^--sensitive-path "\.\.\/x": /);
    // Control characters are escaped, never echoed raw to the terminal.
    let message = '';
    try {
      normalizePattern('a\u001bb');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('\\u001b');
    expect(message).not.toContain('\u001b');
  });

  it('truncates very long inputs in error messages', () => {
    let message = '';
    try {
      normalizePattern('y'.repeat(300));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message.length).toBeLessThan(160);
    expect(message).toContain('…');
  });
});

describe('normalizeSensitivePaths', () => {
  it('normalizes, dedupes and sorts so flag order does not matter', () => {
    expect(normalizeSensitivePaths(['src/z/**', './src/a/**', 'src\\z\\**', 'src/a/'])).toEqual([
      'src/a/**',
      'src/z/**',
    ]);
  });

  it('returns [] when the flag is absent', () => {
    expect(normalizeSensitivePaths([])).toEqual([]);
  });

  it(`caps the number of patterns at ${MAX_SENSITIVE_PATHS}`, () => {
    const many = Array.from({ length: MAX_SENSITIVE_PATHS + 1 }, (_, i) => `p${i}/**`);
    expect(() => normalizeSensitivePaths(many)).toThrow(/at most 100 --sensitive-path patterns/);
    expect(normalizeSensitivePaths(many.slice(0, MAX_SENSITIVE_PATHS))).toHaveLength(100);
  });

  it('reports the first invalid pattern', () => {
    expect(() => normalizeSensitivePaths(['ok/**', '/abs'])).toThrow(/"\/abs"/);
  });
});
