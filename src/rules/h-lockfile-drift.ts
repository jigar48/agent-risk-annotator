import type { RepoContext } from '../context.js';
import type { FileChange } from '../diff/parse.js';
import { depsEqual, manifestKind, parseDeps, type Deps } from '../manifests.js';
import type { Rule, SignalDraft } from './types.js';

/** Lockfile basename → the manifest that owns it. */
const LOCK_TO_MANIFEST: Record<string, string> = {
  'package-lock.json': 'package.json',
  'npm-shrinkwrap.json': 'package.json',
  'yarn.lock': 'package.json',
  'pnpm-lock.yaml': 'package.json',
  'bun.lock': 'package.json',
  'bun.lockb': 'package.json',
  'composer.lock': 'composer.json',
  'poetry.lock': 'pyproject.toml',
  'uv.lock': 'pyproject.toml',
  'Cargo.lock': 'Cargo.toml',
  'go.sum': 'go.mod',
};

const MANIFEST_TO_LOCKS = Object.entries(LOCK_TO_MANIFEST).reduce<Record<string, string[]>>(
  (acc, [lock, manifest]) => {
    (acc[manifest] ??= []).push(lock);
    return acc;
  },
  {},
);

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const within = (path: string, dir: string) => dir === '' || path.startsWith(dir + '/');

/**
 * Rule H — lockfile and manifest out of step.
 *
 * Workspaces share one lockfile across many manifests, so ownership is directory-based:
 * a lockfile is "explained" by any changed manifest in its directory or below, and a
 * manifest is "covered" by the nearest lockfile in its directory or above.
 */
export const ruleH: Rule = {
  id: 'H',
  title: 'Lockfile/manifest drift',
  checkFile(file, ctx) {
    const name = baseOf(file.path);
    const manifest = LOCK_TO_MANIFEST[name];
    if (manifest) return lockWithoutManifest(file, manifest, ctx);
    if (MANIFEST_TO_LOCKS[name]) return manifestWithoutLock(file, name, ctx);
    return [];
  },
};

function lockWithoutManifest(file: FileChange, manifest: string, ctx: RepoContext): SignalDraft[] {
  const dir = dirOf(file.path);
  const explained = ctx.files.some((f) => baseOf(f.path) === manifest && within(f.path, dir));
  if (explained) return [];
  return [
    {
      level: 'MED',
      reason: `${baseOf(file.path)} changed without any ${manifest} change; check for unreviewed dependency updates`,
      evidence: 'dependency manifest',
    },
  ];
}

function manifestWithoutLock(file: FileChange, name: string, ctx: RepoContext): SignalDraft[] {
  const kind = manifestKind(file.path);
  if (!kind) return [];
  const before = readDeps(ctx, 'base', file.path, kind);
  const after = readDeps(ctx, 'head', file.path, kind);
  if (before === null || after === null || depsEqual(before, after)) return [];

  const lock = nearestLock(dirOf(file.path), MANIFEST_TO_LOCKS[name] ?? [], ctx.headPaths());
  if (lock === null) return []; // project doesn't use a lockfile
  if (ctx.files.some((f) => f.path === lock)) return [];
  return [
    {
      level: 'MED',
      reason: `${name} dependencies changed but ${baseOf(lock)} was not updated; installs may drift`,
      evidence: 'dependency manifest',
    },
  ];
}

/** Missing file on one side (added / deleted manifest) means no dependencies there. */
function readDeps(
  ctx: RepoContext,
  side: 'base' | 'head',
  path: string,
  kind: NonNullable<ReturnType<typeof manifestKind>>,
): Deps | null {
  const text = ctx.readFile(side, path);
  return text === null ? new Map() : parseDeps(kind, text);
}

function nearestLock(dir: string, locks: string[], tree: ReadonlySet<string>): string | null {
  for (let d: string | null = dir; d !== null; d = d === '' ? null : dirOf(d)) {
    const found = locks.map((l) => (d === '' ? l : `${d}/${l}`)).find((p) => tree.has(p));
    if (found) return found;
  }
  return null;
}
