import type { RepoContext } from '../context.js';
import type { FileChange, FileStatus, Hunk } from '../diff/parse.js';
import { RULES } from './index.js';
import { LEVEL_RANK, MAX_REASON, type Level, type Rule, type Signal } from './types.js';

export interface HunkAnnotation {
  start: number;
  end: number;
  /** The signal shown in the one-line annotation: highest level, then earliest rule. */
  top: Signal;
  /** Every signal for the hunk, in the same order (JSON / SARIF keep them all). */
  signals: Signal[];
}

export interface FileAnnotation {
  path: string;
  oldPath: string | null;
  status: FileStatus;
  level: Level;
  hunks: HunkAnnotation[];
}

/**
 * Runs every rule over every hunk and keeps only hunks with at least one signal.
 * Output order is fully determined by the input: files by highest level then path,
 * hunks by line, signals by level then rule order.
 */
export function annotate(ctx: RepoContext, rules: readonly Rule[] = RULES): FileAnnotation[] {
  const order = new Map(rules.map((r, i) => [r.id, i]));
  const out: FileAnnotation[] = [];

  for (const file of ctx.files) {
    const hunks = targetHunks(file);
    const perHunk = hunks.map((): Signal[] => []);

    for (const rule of rules) {
      for (const draft of rule.checkFile?.(file, ctx) ?? []) {
        perHunk[0]?.push({ ...draft, ruleId: rule.id });
      }
      if (rule.checkHunk) {
        hunks.forEach((hunk, i) => {
          for (const draft of rule.checkHunk?.(file, hunk, ctx) ?? []) {
            perHunk[i]?.push({ ...draft, ruleId: rule.id });
          }
        });
      }
    }

    // EXTENSION POINT: llm-pass
    // An optional, opt-in model pass would run here: it receives (file, hunk, signals) for
    // each hunk and may append Signals of its own (with a new evidence source). It must not
    // remove or reorder rule signals, so heuristic output stays deterministic without it.

    const annotated: HunkAnnotation[] = [];
    hunks.forEach((hunk, i) => {
      const signals = (perHunk[i] ?? [])
        .map((s) => ({ ...s, reason: clampReason(s.reason) }))
        .sort(
          (a, b) =>
            LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
            (order.get(a.ruleId) ?? 0) - (order.get(b.ruleId) ?? 0),
        );
      const top = signals[0];
      if (top) annotated.push({ start: hunk.start, end: hunk.end, top, signals });
    });
    if (annotated.length === 0) continue;

    out.push({
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      level: annotated.reduce<Level>(
        (lvl, h) => (LEVEL_RANK[h.top.level] > LEVEL_RANK[lvl] ? h.top.level : lvl),
        'LOW',
      ),
      hunks: annotated,
    });
  }

  return out.sort(
    (a, b) =>
      LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}

/**
 * Hunks in line order. Files with no text hunks (binary, pure rename, mode change) get one
 * synthetic L1-1 hunk so file-level rules — a changed *.key, a renamed .env — still report.
 */
function targetHunks(file: FileChange): Hunk[] {
  if (file.hunks.length > 0) return [...file.hunks].sort((a, b) => a.start - b.start);
  return [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 0,
      start: 1,
      end: 1,
      added: [],
      removed: [],
    },
  ];
}

function clampReason(reason: string): string {
  const one = reason.replace(/\s+/g, ' ').trim();
  return one.length <= MAX_REASON ? one : `${one.slice(0, MAX_REASON - 1)}…`;
}
