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
});
