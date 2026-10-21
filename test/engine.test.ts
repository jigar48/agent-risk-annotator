import { describe, expect, it } from 'vitest';
import { annotate } from '../src/rules/engine.js';
import type { Rule } from '../src/rules/types.js';
import { change, fakeContext, hunk } from './helpers/context.js';

const fileRule = (id: Rule['id'], level: 'HIGH' | 'MED' | 'LOW', when = () => true): Rule => ({
  id,
  title: id,
  checkFile: () => (when() ? [{ level, reason: `${id} file`, evidence: 'path heuristic' }] : []),
});

describe('annotate', () => {
  it('omits hunks and files without signals', () => {
    const ctx = fakeContext([change('a.ts', { hunks: [hunk(1), hunk(10)] })]);
    expect(annotate(ctx, [])).toEqual([]);
  });

  it('pins file-level signals to the first hunk by line', () => {
    const ctx = fakeContext([change('a.ts', { hunks: [hunk(30), hunk(5)] })]);
    const [f] = annotate(ctx, [fileRule('E', 'HIGH')]);
    expect(f?.hunks.map((h) => [h.start, h.top.reason])).toEqual([[5, 'E file']]);
  });

  it('gives hunk-less files a synthetic L1-1 hunk so file rules still report', () => {
    const ctx = fakeContext([change('server.key', { hunks: [], isBinary: true })]);
    const [f] = annotate(ctx, [fileRule('E', 'HIGH')]);
    expect(f?.hunks).toMatchObject([{ start: 1, end: 1 }]);
  });

  it('picks the highest level, then the earliest rule, as the top signal', () => {
    const ctx = fakeContext([change('a.ts')]);
    const [f] = annotate(ctx, [fileRule('E', 'MED'), fileRule('F', 'HIGH'), fileRule('G', 'HIGH')]);
    expect(f?.hunks[0]?.top.ruleId).toBe('F');
    expect(f?.hunks[0]?.signals.map((s) => s.ruleId)).toEqual(['F', 'G', 'E']);
    expect(f?.level).toBe('HIGH');
  });

  it('orders files by highest level, then path', () => {
    const ctx = fakeContext([change('z.ts'), change('b.ts'), change('a.ts')]);
    const rule: Rule = {
      id: 'E',
      title: 'E',
      checkFile: (file) => [
        {
          level: file.path === 'z.ts' ? 'HIGH' : 'MED',
          reason: 'r',
          evidence: 'path heuristic',
        },
      ],
    };
    expect(annotate(ctx, [rule]).map((f) => f.path)).toEqual(['z.ts', 'a.ts', 'b.ts']);
  });

  it('clamps reasons to one line of at most 120 chars', () => {
    const ctx = fakeContext([change('a.ts')]);
    const rule: Rule = {
      id: 'E',
      title: 'E',
      checkHunk: () => [{ level: 'LOW', reason: 'x\n'.repeat(100), evidence: 'commit size' }],
    };
    const reason = annotate(ctx, [rule])[0]?.hunks[0]?.top.reason ?? '';
    expect(reason.length).toBe(120);
    expect(reason).not.toContain('\n');
    expect(reason.endsWith('…')).toBe(true);
  });

  it('is deterministic regardless of input file order', () => {
    const files = [change('b.ts'), change('a.ts'), change('c.ts')];
    const rules = [fileRule('E', 'MED')];
    const one = annotate(fakeContext(files), rules);
    const two = annotate(fakeContext([...files].reverse()), rules);
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });
});
