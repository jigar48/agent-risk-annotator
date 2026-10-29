import { describe, expect, it } from 'vitest';
import { parseDiff } from '../../src/diff/parse.js';
import { annotate } from '../../src/rules/engine.js';
import { ruleE } from '../../src/rules/e-sensitive-paths.js';
import { MAX_REASON } from '../../src/rules/types.js';
import { normalizeSensitivePaths } from '../../src/sensitive-paths.js';
import { change, fakeContext } from '../helpers/context.js';

const POLICY = ['.riskannotate.json', 'CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS'];
const OWNERS = 'confirm code-owner review requirements still match intent';
const CONFIG = 'confirm sensitive-path coverage still matches intent';
const advice = (path: string) => (path === '.riskannotate.json' ? CONFIG : OWNERS);

function signals(path: string, opts: Parameters<typeof change>[1] = {}, sensitive: string[] = []) {
  const f = change(path, opts);
  const ctx = fakeContext([f], { sensitivePaths: normalizeSensitivePaths(sensitive) });
  return ruleE.checkFile?.(f, ctx) ?? [];
}

const reasonOf = (path: string, opts: Parameters<typeof change>[1] = {}) =>
  signals(path, opts)[0]?.reason;

describe('Rule E — review-policy files', () => {
  it.each(POLICY)('flags a modified %s as HIGH with one signal', (path) => {
    expect(signals(path)).toEqual([
      {
        level: 'HIGH',
        evidence: 'path heuristic',
        reason: `Review-policy file \`${path}\` changed; ${advice(path)}`,
      },
    ]);
  });

  it.each(POLICY)('flags an added %s', (path) => {
    expect(reasonOf(path, { status: 'added' })).toBe(
      `Review-policy file \`${path}\` added; ${advice(path)}`,
    );
  });

  it.each(POLICY)('flags a deleted %s', (path) => {
    expect(reasonOf(path, { status: 'deleted', hunks: [] })).toBe(
      `Review-policy file \`${path}\` deleted; ${advice(path)}`,
    );
  });

  it('flags a rename into a protected location by its new path', () => {
    expect(reasonOf('.github/CODEOWNERS', { status: 'renamed', oldPath: 'OWNERS.txt' })).toBe(
      `Review-policy file \`.github/CODEOWNERS\` renamed; ${OWNERS}`,
    );
  });

  it('flags a rename away from a protected location by its old path', () => {
    expect(
      reasonOf('docs/archive/CODEOWNERS', { status: 'renamed', oldPath: 'CODEOWNERS', hunks: [] }),
    ).toBe(`Review-policy file \`CODEOWNERS\` renamed away; ${OWNERS}`);
    expect(reasonOf('config/risk.json', { status: 'renamed', oldPath: '.riskannotate.json' })).toBe(
      `Review-policy file \`.riskannotate.json\` renamed away; ${CONFIG}`,
    );
  });

  it('gives a rename between two protected locations one signal, naming the new path', () => {
    const s = signals('.github/CODEOWNERS', { status: 'renamed', oldPath: 'CODEOWNERS' });
    expect(s).toHaveLength(1);
    expect(s[0]?.reason).toBe(`Review-policy file \`.github/CODEOWNERS\` renamed; ${OWNERS}`);
  });

  it('flags a copy onto a protected path, but not a copy whose untouched source is one', () => {
    expect(reasonOf('docs/CODEOWNERS', { status: 'copied', oldPath: 'CODEOWNERS' })).toBe(
      `Review-policy file \`docs/CODEOWNERS\` copied; ${OWNERS}`,
    );
    expect(signals('docs/owners-backup', { status: 'copied', oldPath: 'CODEOWNERS' })).toEqual([]);
  });

  it('flags a mode-only change (no hunks)', () => {
    expect(reasonOf('CODEOWNERS', { hunks: [] })).toBe(
      `Review-policy file \`CODEOWNERS\` changed; ${OWNERS}`,
    );
  });

  it.each([
    'src/CODEOWNERS',
    'docs/sub/CODEOWNERS',
    '.github/workflows/CODEOWNERS',
    'packages/app/.github/CODEOWNERS',
    'packages/app/.riskannotate.json',
    'codeowners',
    '.github/codeowners',
    'CODEOWNERS.md',
    'CODEOWNERS.bak',
    '.riskannotate.json.bak',
    '.riskannotate.jsonc',
    'docs/CODEOWNERS/README.md',
    'OWNERS',
  ])('ignores look-alike %s', (path) => {
    expect(signals(path)).toEqual([]);
    expect(signals(path, { status: 'renamed', oldPath: 'src/unrelated.txt' })).toEqual([]);
  });

  it('is independent of sensitivePaths and wins over a custom pattern', () => {
    expect(signals('CODEOWNERS', {}, [])).toHaveLength(1);
    const withCustom = signals('.riskannotate.json', {}, ['**', '*.json']);
    expect(withCustom).toHaveLength(1);
    expect(withCustom[0]?.reason).toBe(
      `Review-policy file \`.riskannotate.json\` changed; ${CONFIG}`,
    );
  });

  it('keeps existing precedence: earlier built-in categories still win', () => {
    // Only reachable through a rename that touches both kinds of path.
    expect(reasonOf('CODEOWNERS', { status: 'renamed', oldPath: 'src/auth/CODEOWNERS' })).toMatch(
      /^Touches auth code/,
    );
  });

  it('leaves non-policy files to the existing categories and custom patterns', () => {
    expect(reasonOf('src/auth/session.ts')).toMatch(/^Touches auth code/);
    expect(signals('src/payments/x.ts', {}, ['src/payments/**'])[0]?.reason).toMatch(
      /^Matches project sensitive path/,
    );
    expect(signals('src/catalog/x.ts')).toEqual([]);
  });

  it(`keeps every reason within ${MAX_REASON} chars and makes no claim about intent`, () => {
    const reasons = POLICY.flatMap((p) => [
      reasonOf(p),
      reasonOf(p, { status: 'added' }),
      reasonOf(p, { status: 'deleted' }),
      reasonOf(p, { status: 'copied', oldPath: 'x' }),
      reasonOf(p, { status: 'renamed', oldPath: 'x' }),
      reasonOf('elsewhere/x', { status: 'renamed', oldPath: p }),
    ]);
    expect(reasons).toHaveLength(POLICY.length * 6);
    for (const r of reasons) {
      expect(r).toBeDefined();
      expect((r ?? '').length).toBeLessThanOrEqual(MAX_REASON);
      expect(r).not.toMatch(/malicious|attack|bypass|compromise/i);
    }
  });

  it('is pinned to L1-1 by the engine when there are no hunks', () => {
    const f = change('docs/CODEOWNERS', { hunks: [] });
    const [file] = annotate(fakeContext([f]), [ruleE]);
    expect(file?.hunks).toEqual([
      expect.objectContaining({ start: 1, end: 1, top: expect.objectContaining({ ruleId: 'E' }) }),
    ]);
  });
});

describe('Rule E — review-policy files from real diff text', () => {
  const run = (diff: string) => {
    const files = parseDiff(diff);
    return files.map((f) => ({ f, s: ruleE.checkFile?.(f, fakeContext(files)) ?? [] }));
  };

  it('flags a mode-only diff', () => {
    const [r] = run(
      ['diff --git a/CODEOWNERS b/CODEOWNERS', 'old mode 100644', 'new mode 100755', ''].join('\n'),
    );
    expect(r?.f).toMatchObject({ path: 'CODEOWNERS', status: 'modified', hunks: [] });
    expect(r?.s[0]?.reason).toBe(`Review-policy file \`CODEOWNERS\` changed; ${OWNERS}`);
  });

  it('flags a copy diff onto a protected path', () => {
    const [r] = run(
      [
        'diff --git a/CODEOWNERS b/.github/CODEOWNERS',
        'similarity index 100%',
        'copy from CODEOWNERS',
        'copy to .github/CODEOWNERS',
        '',
      ].join('\n'),
    );
    expect(r?.f).toMatchObject({ path: '.github/CODEOWNERS', oldPath: 'CODEOWNERS' });
    expect(r?.s[0]?.reason).toBe(`Review-policy file \`.github/CODEOWNERS\` copied; ${OWNERS}`);
  });

  it('flags pure renames in both directions', () => {
    const rename = (from: string, to: string) =>
      [
        `diff --git a/${from} b/${to}`,
        'similarity index 100%',
        `rename from ${from}`,
        `rename to ${to}`,
        '',
      ].join('\n');
    expect(run(rename('docs/CODEOWNERS', 'docs/old/CODEOWNERS'))[0]?.s[0]?.reason).toBe(
      `Review-policy file \`docs/CODEOWNERS\` renamed away; ${OWNERS}`,
    );
    expect(run(rename('team/OWNERS', 'docs/CODEOWNERS'))[0]?.s[0]?.reason).toBe(
      `Review-policy file \`docs/CODEOWNERS\` renamed; ${OWNERS}`,
    );
  });
});
