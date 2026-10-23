import { describe, expect, it } from 'vitest';
import { annotate } from '../../src/rules/engine.js';
import { ruleE } from '../../src/rules/e-sensitive-paths.js';
import { MAX_REASON } from '../../src/rules/types.js';
import { normalizeSensitivePaths } from '../../src/sensitive-paths.js';
import { change, fakeContext } from '../helpers/context.js';

/** Rule E signals for one file under the given raw --sensitive-path values. */
function signals(path: string, raw: string[], opts: Parameters<typeof change>[1] = {}) {
  const f = change(path, opts);
  return (
    ruleE.checkFile?.(f, fakeContext([f], { sensitivePaths: normalizeSensitivePaths(raw) })) ?? []
  );
}

describe('Rule E — project-specific sensitive paths', () => {
  it('flags a single custom pattern as HIGH, naming it', () => {
    expect(signals('src/payments/charge.ts', ['src/payments/**'])).toEqual([
      {
        level: 'HIGH',
        evidence: 'path heuristic',
        reason: 'Matches project sensitive path `src/payments/**`; review with extra care',
      },
    ]);
  });

  it('supports multiple patterns', () => {
    const raw = ['src/payments/**', '**/webhooks/*.ts', 'settings.py'];
    expect(signals('src/payments/refund.ts', raw)).toHaveLength(1);
    expect(signals('api/stripe/webhooks/handler.ts', raw)).toHaveLength(1);
    expect(signals('mysite/settings.py', raw)).toHaveLength(1);
    expect(signals('src/catalog/list.ts', raw)).toEqual([]);
  });

  it('matches nested directories with ** and stops * at a slash', () => {
    expect(
      signals('app/code/Vendor/Checkout/Model/Payment/Gateway.php', ['app/code/**/Payment/**']),
    ).toHaveLength(1);
    expect(signals('src/payments/deep/er/x.ts', ['src/payments/*'])).toEqual([]);
    expect(signals('src/payments/x.ts', ['src/payments/*'])).toHaveLength(1);
  });

  it('supports ? as exactly one character', () => {
    expect(signals('db/v1/schema.sql', ['db/v?/schema.sql'])).toHaveLength(1);
    expect(signals('db/v10/schema.sql', ['db/v?/schema.sql'])).toEqual([]);
  });

  it('ignores non-matching paths and prefix look-alikes', () => {
    expect(signals('src/paymentsx/x.ts', ['src/payments/**'])).toEqual([]);
    expect(signals('lib/src/payments/x.ts', ['src/payments/**'])).toEqual([]);
    expect(signals('src/payments', ['src/payments/**'])).toEqual([]);
  });

  it('checks both old and new paths for renames', () => {
    const raw = ['src/payments/**'];
    expect(
      signals('src/legacy/charge.ts', raw, {
        status: 'renamed',
        oldPath: 'src/payments/charge.ts',
      }),
    ).toHaveLength(1);
    expect(
      signals('src/payments/charge.ts', raw, {
        status: 'renamed',
        oldPath: 'src/legacy/charge.ts',
      }),
    ).toHaveLength(1);
  });

  it('accepts Windows-style separators in the pattern', () => {
    expect(signals('src/payments/charge.ts', ['src\\payments\\**'])).toHaveLength(1);
  });

  it('keeps built-in categories and their specific reasons', () => {
    // A built-in hit wins over a custom pattern on the same file.
    expect(signals('src/auth/session.ts', ['src/**'])[0]?.reason).toMatch(/^Touches auth code/);
    // Built-ins still fire with custom patterns present.
    expect(signals('.env.production', ['src/payments/**'])[0]?.reason).toMatch(/^Environment file/);
    expect(signals('db/migrations/001.sql', ['src/payments/**'])).toHaveLength(1);
  });

  it('names the first matching pattern in sorted order, independent of flag order', () => {
    const a = signals('src/payments/x.ts', ['src/**', 'src/payments/**']);
    const b = signals('src/payments/x.ts', ['src/payments/**', 'src/**']);
    expect(a).toEqual(b);
    expect(a[0]?.reason).toContain('`src/**`');
  });

  it(`keeps the reason within ${MAX_REASON} chars for long patterns`, () => {
    const long = `${'very-long-directory-name/'.repeat(8)}**`;
    const reason = signals(`${'very-long-directory-name/'.repeat(8)}x.ts`, [long])[0]?.reason ?? '';
    expect(reason.length).toBeLessThanOrEqual(MAX_REASON);
    expect(reason).toContain('…');
  });

  it('changes nothing when no custom patterns are given', () => {
    const f = change('src/payments/charge.ts');
    expect(annotate(fakeContext([f]), [ruleE])).toEqual([]);
  });
});
