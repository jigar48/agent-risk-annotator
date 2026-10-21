import { CoverageError, emptyFile, type FileCoverage, type RawCoverage } from './types.js';

interface PyRegion {
  executed_lines?: number[];
  missing_lines?: number[];
}

interface PyFile extends PyRegion {
  functions?: Record<string, PyRegion>;
}

/**
 * `coverage.json` from `coverage json` (coverage.py). The binary `.coverage` SQLite file is
 * deliberately unsupported: reading it from Node 20 needs a native dependency.
 * Per-function data exists only in coverage.py ≥ 7.5; older reports give line data only.
 */
export function parseCoveragePy(json: unknown): RawCoverage {
  const filesObj = (json as { files?: unknown } | null)?.files;
  if (typeof filesObj !== 'object' || filesObj === null) {
    throw new CoverageError('coverage.json has no "files" object');
  }
  const files = new Map<string, FileCoverage>();

  for (const [path, value] of Object.entries(filesObj as Record<string, PyFile>)) {
    const fc = emptyFile();
    for (const ln of value.missing_lines ?? []) fc.lines.set(ln, 0);
    for (const ln of value.executed_lines ?? []) fc.lines.set(ln, 1);

    for (const [name, fn] of Object.entries(value.functions ?? {})) {
      if (name === '') continue; // module-level code, not a function
      const all = [...(fn.executed_lines ?? []), ...(fn.missing_lines ?? [])];
      if (all.length === 0) continue;
      fc.functions.push({
        name,
        start: Math.min(...all),
        end: Math.max(...all),
        hits: (fn.executed_lines ?? []).length > 0 ? 1 : 0,
      });
    }
    files.set(path, fc);
  }
  return { format: 'coverage.py', files };
}
