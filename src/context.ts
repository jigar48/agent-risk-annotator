import { loadCoverage, type CoverageReport } from './coverage/index.js';
import { parseDiff, type FileChange } from './diff/parse.js';
import {
  assertRepo,
  getAuthorCommits,
  getAuthorEmail,
  getCommitSize,
  getDiff,
  getLog,
  getToplevel,
  historyTip,
  listTree,
  resolveRange,
  showFile,
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
  /** The "before" revision: head~1, the merge base, or null for a root commit. */
  baseRev: string | null;
  files: FileChange[];
  /** Commits before the change (newest first) — excludes the commits under review. */
  history: CommitInfo[];
  coverage: CoverageReport | null;
  warnings: string[];
  /** File content before / after the change; null when absent on that side. Cached. */
  readFile(side: 'base' | 'head', path: string): string | null;
  /** All tracked paths at head. Cached. */
  headPaths(): ReadonlySet<string>;
  /**
   * Sizes (lines changed) of the head author's last commits before the change, newest
   * first, matched by email. Null for a root commit. Cached.
   */
  authorHistory(): AuthorHistory | null;
}

export interface AuthorHistory {
  email: string;
  sizes: number[];
}

/** How many of the author's prior commits Rule C takes the median of. */
export const AUTHOR_SAMPLE = 10;

export function buildContext(opts: ContextOptions): RepoContext {
  assertRepo(opts.cwd);
  const root = getToplevel(opts.cwd);
  const range = resolveRange({ base: opts.base, head: opts.head }, root);
  const files = parseDiff(getDiff(range, root));

  const baseRev = historyTip(range, root);
  const history = baseRev === null ? [] : getLog(baseRev, HISTORY_DEPTH, root);

  const { report, warnings } = loadCoverage(root, opts.coveragePath, opts.cwd);

  const reads = new Map<string, string | null>();
  let tree: Set<string> | null = null;
  let author: AuthorHistory | null | undefined;

  return {
    root,
    range,
    baseRev,
    files,
    history,
    coverage: report,
    warnings,
    readFile(side, path) {
      const rev = side === 'head' ? range.head : baseRev;
      if (rev === null) return null;
      const key = `${side}\0${path}`;
      if (!reads.has(key)) reads.set(key, showFile(rev, path, root));
      return reads.get(key) ?? null;
    },
    headPaths() {
      tree ??= new Set(listTree(range.head, root));
      return tree;
    },
    authorHistory() {
      if (author === undefined) {
        if (baseRev === null) {
          author = null;
        } else {
          const email = getAuthorEmail(range.head, root);
          const hashes = getAuthorCommits(email, baseRev, AUTHOR_SAMPLE, root);
          author = { email, sizes: hashes.map((h) => getCommitSize(h, root)) };
        }
      }
      return author;
    },
  };
}
