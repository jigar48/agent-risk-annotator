import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, isAbsolute, resolve } from 'node:path';
import { parseCoveragePy } from './coveragepy.js';
import { parseIstanbul } from './istanbul.js';
import { parseLcov } from './lcov.js';
import { CoverageError, type CoverageFormat, type FileCoverage, type RawCoverage } from './types.js';

export { CoverageError } from './types.js';
export type { CoverageFormat, FileCoverage, FunctionCoverage } from './types.js';

/** Probed in order, relative to the repo root, when --coverage is not given. */
export const DEFAULT_COVERAGE_PATHS = [
  'coverage/coverage-final.json',
  'coverage/lcov.info',
  'lcov.info',
  'coverage.json',
] as const;

export interface CoverageReport {
  format: CoverageFormat;
  sourcePath: string;
  /** Coverage for a repo-relative POSIX path, or undefined when the report doesn't cover it. */
  lookup(path: string): FileCoverage | undefined;
}

export interface LoadedCoverage {
  report: CoverageReport | null;
  /** Non-fatal problems with auto-detected files, for stderr. */
  warnings: string[];
}

/**
 * An explicit path must exist and parse (errors throw). Auto-detected files that fail to
 * parse are skipped with a warning, so a stale or odd file never breaks a run.
 */
export function loadCoverage(root: string, explicit?: string, cwd = root): LoadedCoverage {
  if (explicit !== undefined) {
    const path = resolve(cwd, explicit);
    if (!existsSync(path)) throw new CoverageError(`coverage file not found: ${explicit}`);
    return { report: createReport(readCoverageFile(path), root, path), warnings: [] };
  }

  const warnings: string[] = [];
  for (const rel of DEFAULT_COVERAGE_PATHS) {
    const path = resolve(root, rel);
    if (!existsSync(path)) continue;
    try {
      return { report: createReport(readCoverageFile(path), root, path), warnings };
    } catch (err) {
      warnings.push(`ignoring ${rel}: ${(err as Error).message}`);
    }
  }
  return { report: null, warnings };
}

export function readCoverageFile(path: string): RawCoverage {
  const text = readFileSync(path, 'utf8');
  const ext = extname(path).toLowerCase();
  if (ext === '.info' || basename(path).toLowerCase().includes('lcov')) return parseLcov(text);

  if (ext === '.json') {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new CoverageError(`${basename(path)} is not valid JSON`);
    }
    const o = json as Record<string, unknown> | null;
    const isCoveragePy = o !== null && typeof o === 'object' && 'files' in o && 'meta' in o;
    return isCoveragePy ? parseCoveragePy(json) : parseIstanbul(json);
  }

  if (/^(TN|SF):/m.test(text)) return parseLcov(text);
  throw new CoverageError(`unrecognized coverage format: ${basename(path)}`);
}

/**
 * Maps report paths onto repo paths. Reports may hold absolute paths (istanbul), paths
 * relative to wherever tests ran (lcov in a monorepo package), or paths from another
 * machine (CI). Exact match first, then a unique suffix match in either direction; an
 * ambiguous match yields nothing rather than a guess.
 */
export function createReport(raw: RawCoverage, root: string, sourcePath: string): CoverageReport {
  const rootKey = normalize(root).replace(/\/$/, '');
  const caseFold = process.platform === 'win32';
  const fold = (s: string) => (caseFold ? s.toLowerCase() : s);

  const byKey = new Map<string, FileCoverage>();
  for (const [p, fc] of raw.files) {
    let key = normalize(p);
    if (isAbs(key) && fold(key).startsWith(fold(rootKey) + '/')) key = key.slice(rootKey.length + 1);
    byKey.set(fold(key), fc);
  }
  const keys = [...byKey.keys()];

  return {
    format: raw.format,
    sourcePath,
    lookup(path) {
      const want = fold(normalize(path));
      const exact = byKey.get(want);
      if (exact) return exact;
      const hits = keys.filter((k) => k.endsWith('/' + want) || want.endsWith('/' + k));
      return hits.length === 1 ? byKey.get(hits[0] as string) : undefined;
    },
  };
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isAbs(p: string): boolean {
  return isAbsolute(p) || p.startsWith('/') || /^[A-Za-z]:\//.test(p);
}
