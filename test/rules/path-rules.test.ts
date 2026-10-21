import { describe, expect, it } from 'vitest';
import { ruleE } from '../../src/rules/e-sensitive-paths.js';
import { ruleF } from '../../src/rules/f-deleted-tests.js';
import { ruleG } from '../../src/rules/g-ci-infra.js';
import { MAX_REASON } from '../../src/rules/types.js';
import { change, fakeContext, hunk } from '../helpers/context.js';

const fileSignals = (rule: typeof ruleE, path: string, opts: Parameters<typeof change>[1] = {}) => {
  const f = change(path, opts);
  return rule.checkFile?.(f, fakeContext([f])) ?? [];
};

describe('Rule E — sensitive paths', () => {
  it.each([
    'src/auth/session.ts',
    'auth/index.js',
    'lib/crypto/aes.go',
    'config/secrets/prod.yaml',
    'certs/server.pem',
    'deploy/tls.key',
    '.env',
    'apps/web/.env.production',
    'db/migrations/20260101_add_users.sql',
  ])('flags %s as HIGH', (path) => {
    expect(fileSignals(ruleE, path)).toEqual([
      expect.objectContaining({ level: 'HIGH', evidence: 'path heuristic' }),
    ]);
  });

  it.each(['src/oauth-client.ts', 'src/authors.ts', 'keys.ts', 'docs/env.md'])(
    'ignores %s',
    (path) => {
      expect(fileSignals(ruleE, path)).toEqual([]);
    },
  );

  it('flags a file moved out of a sensitive directory', () => {
    expect(
      fileSignals(ruleE, 'src/session.ts', { status: 'renamed', oldPath: 'src/auth/session.ts' }),
    ).toHaveLength(1);
  });

  it('gives a category-specific reason', () => {
    expect(fileSignals(ruleE, 'db/migrations/1.sql')[0]?.reason).toMatch(/migration/i);
    expect(fileSignals(ruleE, '.env.local')[0]?.reason).toMatch(/environment/i);
  });
});

describe('Rule F — deleted tests', () => {
  const hunkSignals = (path: string, h: ReturnType<typeof hunk>, status?: 'deleted') => {
    const f = change(path, { hunks: [h], status });
    return ruleF.checkHunk?.(f, h, fakeContext([f])) ?? [];
  };

  it.each(['src/a.test.ts', 'web/b.spec.js', 'tests/test_api.py', 'pkg/x_test.go'])(
    'flags removed lines in %s as HIGH',
    (path) => {
      expect(hunkSignals(path, hunk(4, [], ['expect(x).toBe(1)']))).toEqual([
        expect.objectContaining({ level: 'HIGH', evidence: 'path heuristic' }),
      ]);
    },
  );

  it('ignores additions-only hunks and non-test files', () => {
    expect(hunkSignals('src/a.test.ts', hunk(4, ['it("new")']))).toEqual([]);
    expect(hunkSignals('src/a.ts', hunk(4, [], ['gone']))).toEqual([]);
  });

  it('words the reason by what happened', () => {
    expect(hunkSignals('a.test.ts', hunk(1, [], ['a', 'b']))[0]?.reason).toMatch(
      /^Removes 2 test lines/,
    );
    expect(hunkSignals('a.test.ts', hunk(1, ['b'], ['a']))[0]?.reason).toMatch(
      /^Rewrites 1 test line;/,
    );
    expect(hunkSignals('a.test.ts', hunk(1, [], ['a']), 'deleted')[0]?.reason).toMatch(
      /^Deletes a test file/,
    );
  });
});

describe('Rule G — CI/infra', () => {
  it.each([
    '.github/workflows/release.yml',
    'Dockerfile',
    'services/api/Dockerfile.dev',
    'docker-compose.override.yml',
    'infra/terraform/main.tf',
    'terraform/vars.tf',
    'deploy/k8s/deployment.yaml',
  ])('flags %s as MED', (path) => {
    expect(fileSignals(ruleG, path)).toEqual([
      expect.objectContaining({ level: 'MED', evidence: 'path heuristic' }),
    ]);
  });

  it.each(['.github/CODEOWNERS', 'docs/docker.md', 'src/k8s.ts'])('ignores %s', (path) => {
    expect(fileSignals(ruleG, path)).toEqual([]);
  });
});

describe('reason length', () => {
  it(`every E/F/G reason fits in ${MAX_REASON} chars`, () => {
    const paths = [
      'a/auth/x',
      'a/crypto/x',
      'a/secrets/x',
      'x.pem',
      '.env',
      'a/migrations/x',
      '.github/workflows/x',
      'Dockerfile',
      'docker-compose.yml',
      'terraform/x',
      'k8s/x',
    ];
    const reasons = [
      ...paths.flatMap((p) => [...fileSignals(ruleE, p), ...fileSignals(ruleG, p)]),
      ...(ruleF.checkHunk?.(
        change('a.test.ts', { status: 'deleted' }),
        hunk(1, [], Array(99999).fill('x')),
        fakeContext([]),
      ) ?? []),
    ].map((s) => s.reason);
    expect(reasons.length).toBeGreaterThan(10);
    for (const r of reasons) expect(r.length).toBeLessThanOrEqual(MAX_REASON);
  });
});
