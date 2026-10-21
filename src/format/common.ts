import { EMPTY_TREE, type DiffRange } from '../git.js';
import type { FileAnnotation } from '../rules/engine.js';
import type { Level } from '../rules/types.js';

export interface ReportMeta {
  range: DiffRange;
  warnings: string[];
}

export type Format = 'markdown' | 'json' | 'sarif';

export const FORMATS: readonly Format[] = ['markdown', 'json', 'sarif'];

export const NO_SIGNALS = 'No risk signals found.';

/** Hunk counts by the level shown in each annotation. */
export function countLevels(files: readonly FileAnnotation[]): Record<Level, number> {
  const counts: Record<Level, number> = { HIGH: 0, MED: 0, LOW: 0 };
  for (const f of files) for (const h of f.hunks) counts[h.top.level]++;
  return counts;
}

/** "HEAD~1..HEAD", "main...feature", or "(root)..HEAD" for a root commit. */
export function describeRange(range: DiffRange): string {
  const base = range.base === EMPTY_TREE ? '(root)' : range.base;
  return `${base}${range.threeDot ? '...' : '..'}${range.head}`;
}
