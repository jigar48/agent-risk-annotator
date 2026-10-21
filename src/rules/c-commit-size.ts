import type { RepoContext } from '../context.js';
import type { Hunk } from '../diff/parse.js';
import type { Rule } from './types.js';

/** Fewer prior commits than this and the median means nothing; the rule stays silent. */
export const MIN_SAMPLE = 3;
export const SIZE_FACTOR = 3;

interface Verdict {
  path: string;
  hunk: Hunk;
  reason: string;
}

const verdicts = new WeakMap<RepoContext, Verdict | null>();

/**
 * Rule C — the whole diff is more than 3× the median size of the head author's last 10
 * commits before the change. Reported once, as LOW, on the largest hunk.
 */
export const ruleC: Rule = {
  id: 'C',
  title: 'Outsized diff',
  checkHunk(file, hunk, ctx) {
    if (!verdicts.has(ctx)) verdicts.set(ctx, judge(ctx));
    const v = verdicts.get(ctx);
    if (!v || v.path !== file.path || v.hunk !== hunk) return [];
    return [{ level: 'LOW', reason: v.reason, evidence: 'commit size' }];
  },
};

function judge(ctx: RepoContext): Verdict | null {
  const history = ctx.authorHistory();
  if (!history || history.sizes.length < MIN_SAMPLE) return null;
  const med = median(history.sizes);
  if (med === 0) return null;

  let total = 0;
  let largest: { path: string; hunk: Hunk; size: number } | null = null;
  for (const f of ctx.files) {
    for (const h of f.hunks) {
      const size = h.added.length + h.removed.length;
      total += size;
      if (!largest || size > largest.size) largest = { path: f.path, hunk: h, size };
    }
  }
  if (!largest || total <= SIZE_FACTOR * med) return null;

  const ratio = (total / med).toFixed(1);
  return {
    path: largest.path,
    hunk: largest.hunk,
    reason: `Diff is ${total} lines, ${ratio}x this author's median of ${med} over ${history.sizes.length} commits; consider splitting`,
  };
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}
