import type { RepoContext } from '../../src/context.js';
import type { FileChange, FileStatus, Hunk } from '../../src/diff/parse.js';
import { EMPTY_TREE } from '../../src/git.js';

/** In-memory context for rules that only look at paths and hunks. */
export function fakeContext(files: FileChange[], extra: Partial<RepoContext> = {}): RepoContext {
  return {
    root: '/repo',
    range: { base: EMPTY_TREE, head: 'HEAD', threeDot: false },
    baseRev: null,
    files,
    history: [],
    coverage: null,
    warnings: [],
    sensitivePaths: [],
    readFile: () => null,
    headPaths: () => new Set(files.map((f) => f.path)),
    authorHistory: () => null,
    ...extra,
  };
}

export function hunk(start: number, added: string[] = ['x'], removed: string[] = []): Hunk {
  const newLines = added.length;
  return {
    oldStart: start,
    oldLines: removed.length,
    newStart: start,
    newLines,
    start,
    end: newLines > 0 ? start + newLines - 1 : start,
    added,
    removed,
  };
}

export function change(
  path: string,
  opts: { status?: FileStatus; oldPath?: string; hunks?: Hunk[]; isBinary?: boolean } = {},
): FileChange {
  return {
    path,
    oldPath: opts.oldPath ?? null,
    status: opts.status ?? 'modified',
    isBinary: opts.isBinary ?? false,
    hunks: opts.hunks ?? [hunk(1)],
  };
}
