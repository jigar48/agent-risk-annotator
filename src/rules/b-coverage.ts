import type { FileCoverage, FunctionCoverage } from '../coverage/index.js';
import type { Rule } from './types.js';

/**
 * Rule B — changed lines inside a file or function with 0% coverage. Silent without a
 * coverage report or when the report doesn't cover the file. Pure deletions have no new
 * lines and are skipped. The report is assumed to describe the head version of the code.
 */
export const ruleB: Rule = {
  id: 'B',
  title: 'Uncovered code',
  checkHunk(file, hunk, ctx) {
    if (hunk.newLines === 0) return [];
    const fc = ctx.coverage?.lookup(file.path);
    if (!fc || fc.lines.size === 0) return [];

    if ([...fc.lines.values()].every((hits) => hits === 0)) {
      return [
        {
          level: 'MED',
          reason: 'Changes a file with 0% test coverage; no test exercises these lines',
          evidence: 'coverage report',
        },
      ];
    }

    const fn = spans(fc).find(
      (s) => s.fn.hits === 0 && s.start <= hunk.end && s.end >= hunk.start,
    )?.fn;
    if (!fn) return [];
    // istanbul names unnamed callbacks "(anonymous_3)".
    const label = fn.name.startsWith('(anonymous')
      ? 'an anonymous function'
      : `${fn.name.length > 40 ? `${fn.name.slice(0, 39)}…` : fn.name}()`;
    return [
      {
        level: 'MED',
        reason: `Changes ${label}, which has 0% test coverage; no test exercises it`,
        evidence: 'coverage report',
      },
    ];
  },
};

/**
 * Function line spans. lcov 1.x only records where a function starts, so its end is taken
 * as the line before the next function starts (or the last instrumented line).
 */
function spans(fc: FileCoverage): { fn: FunctionCoverage; start: number; end: number }[] {
  const sorted = [...fc.functions].sort((a, b) => a.start - b.start);
  const lastLine = Math.max(...fc.lines.keys());
  return sorted.map((fn, i) => {
    const next = sorted.slice(i + 1).find((f) => f.start > fn.start);
    return { fn, start: fn.start, end: fn.end ?? (next ? next.start - 1 : lastLine) };
  });
}
