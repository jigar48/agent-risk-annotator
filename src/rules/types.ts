import type { RepoContext } from '../context.js';
import type { FileChange, Hunk } from '../diff/parse.js';

export type Level = 'HIGH' | 'MED' | 'LOW';

export const LEVEL_RANK: Record<Level, number> = { LOW: 1, MED: 2, HIGH: 3 };

export type Evidence =
  'git log' | 'coverage report' | 'commit size' | 'dependency manifest' | 'path heuristic';

export type RuleId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

/** What a rule reports; the engine stamps the rule id. */
export interface SignalDraft {
  level: Level;
  /** One sentence, ≤120 chars: what was detected and why it matters. */
  reason: string;
  evidence: Evidence;
}

export interface Signal extends SignalDraft {
  ruleId: RuleId;
}

export interface Rule {
  id: RuleId;
  /** Short name, used for SARIF rule metadata and docs. */
  title: string;
  /** Whole-file signals. The engine pins them to the file's first hunk. */
  checkFile?(file: FileChange, ctx: RepoContext): SignalDraft[];
  /** Per-hunk signals. */
  checkHunk?(file: FileChange, hunk: Hunk, ctx: RepoContext): SignalDraft[];
}

export const MAX_REASON = 120;
