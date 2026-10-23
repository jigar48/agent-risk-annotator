import { describe, expect, it } from 'vitest';
import { matchAny, matchGlob } from '../src/util/glob.js';

describe('matchGlob', () => {
  it.each([
    ['*.pem', 'certs/server.pem', true],
    ['*.pem', 'server.pem.bak', false],
    ['.env*', '.env', true],
    ['.env*', 'app/.env.local', true],
    ['.env*', 'src/env.ts', false],
    ['*.test.*', 'src/a.test.ts', true],
    ['*.test.*', 'src/test.ts', false],
    ['test_*.py', 'pkg/tests/test_api.py', true],
    ['*_test.go', 'cmd/main_test.go', true],
    ['Dockerfile*', 'services/api/Dockerfile.prod', true],
    ['**/auth/**', 'auth/login.ts', true],
    ['**/auth/**', 'src/auth/session/store.ts', true],
    ['**/auth/**', 'src/oauth/x.ts', false],
    ['**/auth/**', 'src/auth.ts', false],
    ['**/migrations/**', 'db/migrations/001_init.sql', true],
    ['.github/workflows/**', '.github/workflows/ci.yml', true],
    ['.github/workflows/**', 'sub/.github/workflows/ci.yml', false],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/deep/a.ts', false],
    ['src/**/*.ts', 'src/a.ts', true],
    ['src/**/*.ts', 'src/deep/er/a.ts', true],
    ['*.{yml,yaml}', 'k8s/deploy.yaml', true],
    ['?.ts', 'a.ts', true],
    ['?.ts', 'ab.ts', false],
    ['a+b(c).txt', 'a+b(c).txt', true],
  ])('%s vs %s → %s', (pattern, path, expected) => {
    expect(matchGlob(path, pattern)).toBe(expected);
  });

  it('matchAny returns the first matching pattern', () => {
    expect(matchAny('x/a.spec.js', ['*.test.*', '*.spec.*'])).toBe('*.spec.*');
    expect(matchAny('x/a.js', ['*.test.*'])).toBeUndefined();
  });

  it.each([
    // `**` semantics: zero or more segments at start/middle, one or more at the end.
    ['**/x.ts', 'x.ts', true],
    ['src/**/x.ts', 'src/x.ts', true],
    ['src/**/**/x.ts', 'src/a/b/x.ts', true],
    ['src/**', 'src', false],
    ['src/**', 'src/a', true],
    ['**/auth/**', 'src/auth', false],
    // `*` and `?` never cross a slash.
    ['src/*', 'src/a/b', false],
    ['src/?/x', 'src/ab/x', false],
    ['src/?/x', 'src/a/x', true],
    // A `*` wildcard matches a literal star in a name too.
    ['*x', '*ax', true],
    // Matching is case-sensitive, like git paths.
    ['src/Payments/**', 'src/payments/x.ts', false],
    // Literal characters that are regex metacharacters.
    ['a.b$c^d|e', 'a.b$c^d|e', true],
    ['a.b', 'axb', false],
  ])('%s vs %s → %s', (pattern, path, expected) => {
    expect(matchGlob(path, pattern)).toBe(expected);
  });

  it('has no catastrophic backtracking on adversarial patterns (ReDoS regression)', () => {
    // With the previous regex-based matcher, 12 stars against 30 chars took ~1.9 s.
    const cases: [string, string][] = [
      [`x/${'*a'.repeat(40)}*b`, `x/${'a'.repeat(4000)}`],
      [`${'**/'.repeat(30)}z`, `${'d/'.repeat(500)}y`],
      [`${'*a'.repeat(40)}*b`, 'a'.repeat(4000)],
    ];
    const start = performance.now();
    for (const [pattern, path] of cases) expect(matchGlob(path, pattern)).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
