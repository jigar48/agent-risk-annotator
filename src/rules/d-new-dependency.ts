import type { RepoContext } from '../context.js';
import type { FileChange, Hunk } from '../diff/parse.js';
import { manifestKind, parseDeps } from '../manifests.js';
import type { Rule } from './types.js';

const placements = new WeakMap<FileChange, Map<Hunk, string[]>>();

/**
 * Rule D — a direct dependency present at head but not before. Each new dependency is
 * reported on the hunk that adds its line (falling back to the first hunk), so a reviewer
 * lands on the exact entry.
 */
export const ruleD: Rule = {
  id: 'D',
  title: 'New dependency',
  checkHunk(file, hunk, ctx) {
    if (!placements.has(file)) placements.set(file, place(file, ctx));
    const names = placements.get(file)?.get(hunk);
    if (!names || names.length === 0) return [];
    return [{ level: 'MED', reason: describe(names), evidence: 'dependency manifest' }];
  },
};

function place(file: FileChange, ctx: RepoContext): Map<Hunk, string[]> {
  const out = new Map<Hunk, string[]>();
  const kind = manifestKind(file.path);
  if (!kind || file.status === 'deleted' || file.hunks.length === 0) return out;

  const headText = ctx.readFile('head', file.path);
  if (headText === null) return out;
  const after = parseDeps(kind, headText);
  const beforeText = ctx.readFile('base', file.oldPath ?? file.path);
  const before = beforeText === null ? new Map() : parseDeps(kind, beforeText);
  if (!after || !before) return out;

  const hunks = [...file.hunks].sort((a, b) => a.start - b.start);
  for (const name of [...after.keys()].filter((n) => !before.has(n)).sort()) {
    const re = namePattern(name);
    const target = hunks.find((h) => h.added.some((l) => re.test(l))) ?? hunks[0];
    if (!target) continue;
    const list = out.get(target) ?? [];
    list.push(name);
    out.set(target, list);
  }
  return out;
}

/** Matches the name as a whole token; Python's normalized "-" also matches "_" and ".". */
function namePattern(name: string): RegExp {
  const body = name
    .split('-')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[-_.]');
  return new RegExp(`(^|[^\\w@/.-])${body}($|[^\\w/.-])`, 'i');
}

// Name budgets keep the worst case ("Adds 99 new dependencies (…, … and 97 more)") ≤120 chars.
function describe(names: string[]): string {
  if (names.length === 1) {
    return `Adds new dependency "${short(names[0] as string, 30)}"; review provenance, license and maintenance`;
  }
  const shown = names
    .slice(0, 2)
    .map((n) => short(n, 20))
    .join(', ');
  const more = names.length > 2 ? ` and ${names.length - 2} more` : '';
  return `Adds ${names.length} new dependencies (${shown}${more}); review provenance and license`;
}

function short(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}
