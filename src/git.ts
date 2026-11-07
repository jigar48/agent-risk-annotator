import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Hash of git's empty tree; diffing against it shows every file in a root commit as added. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export class GitError extends Error {
  override name = 'GitError';
}

export interface DiffRange {
  base: string;
  head: string;
  /** true → `git diff base...head` (merge-base); false → `git diff base head`. */
  threeDot: boolean;
}

/**
 * Runs git and returns stdout. `-c` overrides neutralize user config that would change
 * the output shape we parse (quoted paths, colour, external diff drivers).
 */
export function git(args: readonly string[], cwd: string): string {
  return run(args, cwd, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/**
 * Object-database reads for `--config-ref`. GIT_NO_LAZY_FETCH stops a partial clone from
 * fetching a missing object from its promisor remote: a missing object is an error, never a
 * network call. Output is returned as raw bytes and capped at `maxBuffer`.
 */
function gitObject(args: readonly string[], cwd: string, maxBuffer: number): Buffer {
  return run(args, cwd, {
    encoding: 'buffer',
    maxBuffer,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
  });
}

function run(
  args: readonly string[],
  cwd: string,
  opts: { encoding: 'utf8'; maxBuffer: number; env?: NodeJS.ProcessEnv },
): string;
function run(
  args: readonly string[],
  cwd: string,
  opts: { encoding: 'buffer'; maxBuffer: number; env?: NodeJS.ProcessEnv },
): Buffer;
function run(
  args: readonly string[],
  cwd: string,
  opts: { encoding: 'utf8' | 'buffer'; maxBuffer: number; env?: NodeJS.ProcessEnv },
): string | Buffer {
  try {
    return execFileSync('git', ['-c', 'core.quotePath=false', '-c', 'color.ui=never', ...args], {
      cwd,
      encoding: opts.encoding,
      maxBuffer: opts.maxBuffer,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(opts.env ? { env: opts.env } : {}),
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') {
      // spawn reports a missing cwd and a missing binary the same way.
      throw new GitError(
        existsSync(cwd) ? 'git executable not found on PATH' : `directory not found: ${cwd}`,
      );
    }
    const detail = String(e.stderr ?? '').trim() || e.message;
    throw new GitError(`git ${args[0] ?? ''} failed: ${detail}`);
  }
}

export function refExists(ref: string, cwd: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

export function assertRepo(cwd: string): void {
  if (!existsSync(cwd)) throw new GitError(`directory not found: ${cwd}`);
  try {
    git(['rev-parse', '--git-dir'], cwd);
  } catch {
    throw new GitError(`not a git repository: ${cwd}`);
  }
}

/**
 * Default: `<head>~1..<head>`, falling back to the empty tree when head is a root commit.
 * With a base: `<base>...<head>`, i.e. only what head added since it diverged from base.
 */
export function resolveRange(opts: { base?: string; head?: string }, cwd: string): DiffRange {
  const head = opts.head ?? 'HEAD';
  if (!refExists(head, cwd)) throw new GitError(`unknown revision: ${head}`);

  if (opts.base !== undefined) {
    if (!refExists(opts.base, cwd)) throw new GitError(`unknown revision: ${opts.base}`);
    return { base: opts.base, head, threeDot: true };
  }

  const parent = `${head}~1`;
  return { base: refExists(parent, cwd) ? parent : EMPTY_TREE, head, threeDot: false };
}

export function getToplevel(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd).trim();
}

export interface CommitInfo {
  hash: string;
  authorEmail: string;
  subject: string;
  /** Paths touched by the commit (new names for renames). Empty for merges. */
  files: string[];
}

/** The commit history the change is judged against: what existed before it. */
export function historyTip(range: DiffRange, cwd: string): string | null {
  if (range.base === EMPTY_TREE) return null;
  if (!range.threeDot) return range.base;
  return git(['merge-base', range.base, range.head], cwd).trim() || null;
}

const RS = '\x1e';
const US = '\x1f';

/** Last `n` commits reachable from `rev`, newest first. */
export function getLog(rev: string, n: number, cwd: string): CommitInfo[] {
  const out = git(
    ['log', `-n${n}`, `--format=${RS}%H${US}%ae${US}%s`, '--name-only', rev, '--'],
    cwd,
  );
  return out
    .split(RS)
    .filter((rec) => rec.trim() !== '')
    .map((rec) => {
      const [header = '', ...rest] = rec.split('\n');
      const [hash = '', authorEmail = '', subject = ''] = header.split(US);
      return { hash, authorEmail, subject, files: rest.filter((l) => l !== '') };
    });
}

export function getAuthorEmail(rev: string, cwd: string): string {
  return git(['log', '-1', '--format=%ae', rev, '--'], cwd).trim();
}

/**
 * Last `n` non-merge commits by exactly this author email reachable from `rev`.
 * `--author` is a regex, so the email is escaped and anchored in its <…> brackets.
 */
export function getAuthorCommits(email: string, rev: string, n: number, cwd: string): string[] {
  const pattern = `<${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`;
  return git(['log', '--no-merges', `--author=${pattern}`, '--format=%H', `-n${n}`, rev, '--'], cwd)
    .split('\n')
    .filter((h) => h !== '');
}

/** Lines inserted + deleted by one commit, from `git show --shortstat`. */
export function getCommitSize(hash: string, cwd: string): number {
  const stat = git(['show', '--shortstat', '--format=', hash], cwd);
  const ins = /(\d+) insertions?\(\+\)/.exec(stat)?.[1] ?? '0';
  const del = /(\d+) deletions?\(-\)/.exec(stat)?.[1] ?? '0';
  return Number(ins) + Number(del);
}

/** File content at a revision, or null if it doesn't exist there. */
export function showFile(rev: string, path: string, cwd: string): string | null {
  try {
    return git(['show', `${rev}:${path}`], cwd);
  } catch {
    return null;
  }
}

/** Every tracked path at a revision. */
export function listTree(rev: string, cwd: string): string[] {
  return git(['ls-tree', '-r', '-z', '--name-only', rev], cwd)
    .split('\0')
    .filter((p) => p !== '');
}

export function getDiff(range: DiffRange, cwd: string): string {
  const spec = range.threeDot ? [`${range.base}...${range.head}`] : [range.base, range.head];
  return git(
    [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '-U0',
      '-M',
      // Explicit prefixes override diff.noprefix / diff.mnemonicPrefix in user config.
      '--src-prefix=a/',
      '--dst-prefix=b/',
      ...spec,
      '--',
    ],
    cwd,
  );
}

/**
 * Resolves `ref` to a full commit hash, peeling annotated tags. Returns null when the ref
 * names no object at all, or `{ type }` when it names an object that is not a commit-ish.
 */
export function resolveCommit(
  ref: string,
  cwd: string,
): { commit: string } | { commit: null; type: string | null } {
  try {
    const out = gitObject(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd, 1024);
    const hash = out.toString('utf8').trim();
    if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hash)) return { commit: hash };
  } catch {
    // fall through: find out what, if anything, the ref names
  }
  try {
    const out = gitObject(['cat-file', '-t', ref], cwd, 1024);
    return { commit: null, type: out.toString('utf8').trim() };
  } catch {
    return { commit: null, type: null };
  }
}

export interface TreeEntry {
  mode: string;
  type: string;
  oid: string;
}

/**
 * The entry named exactly `name` at the root of `commit`'s tree, or null when absent.
 * `--full-tree` makes the lookup independent of the working directory.
 */
export function rootTreeEntry(commit: string, name: string, cwd: string): TreeEntry | null {
  const out = gitObject(
    ['ls-tree', '-z', '--full-tree', commit, '--', name],
    cwd,
    64 * 1024,
  ).toString('utf8');
  for (const rec of out.split('\0')) {
    const tab = rec.indexOf('\t');
    if (tab < 0) continue;
    if (rec.slice(tab + 1) !== name) continue;
    const [mode = '', type = '', oid = ''] = rec.slice(0, tab).split(' ');
    return { mode, type, oid };
  }
  return null;
}

/** Size in bytes of a blob, read from the object header without reading its content. */
export function blobSize(oid: string, cwd: string): number {
  const out = gitObject(['cat-file', '-s', oid], cwd, 1024).toString('utf8').trim();
  if (!/^\d+$/.test(out)) throw new GitError(`git cat-file -s returned unexpected output`);
  return Number(out);
}

/**
 * Raw bytes of a blob. Reads at most `limit` + 1 bytes: a larger object makes git's output
 * overflow the buffer and the read fails instead of being truncated. No filters, textconv or
 * hooks run: `cat-file blob` returns the object exactly as stored.
 */
export function readBlob(oid: string, limit: number, cwd: string): Uint8Array {
  return gitObject(['cat-file', 'blob', oid], cwd, limit + 1);
}
