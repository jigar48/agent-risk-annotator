import { loadCoverage, type CoverageReport } from './coverage/index.js';
import { parseDiff, type FileChange } from './diff/parse.js';
import {
  assertRepo,
  getDiff,
  getLog,
  getToplevel,
  historyTip,
  resolveRange,
  type CommitInfo,
  type DiffRange,
} from './git.js';

/** How far back history-based rules look (Rule A: last 30 commits). */
export const HISTORY_DEPTH = 30;

export interface ContextOptions {
  cwd: string;
  base?: string;
  head?: string;
  coveragePath?: string;
}

/** Everything rules need, gathered once so each rule is a pure function of it. */
export interface RepoContext {
  root: string;
  range: DiffRange;
  files: FileChange[];
  /** Commits before the change (newest first) — excludes the commits under review. */
  history: CommitInfo[];
  coverage: CoverageReport | null;
  warnings: string[];
}

export function buildContext(opts: ContextOptions): RepoContext {
  assertRepo(opts.cwd);
  const root = getToplevel(opts.cwd);
  const range = resolveRange({ base: opts.base, head: opts.head }, root);
  const files = parseDiff(getDiff(range, root));

  const tip = historyTip(range, root);
  const history = tip === null ? [] : getLog(tip, HISTORY_DEPTH, root);

  const { report, warnings } = loadCoverage(root, opts.coveragePath, opts.cwd);
  return { root, range, files, history, coverage: report, warnings };
}
