import { CoverageError, emptyFile, setHits, type FileCoverage, type RawCoverage } from './types.js';

interface Loc {
  start: { line: number };
  end: { line: number };
}

interface IstanbulFile {
  path?: string;
  statementMap: Record<string, Loc>;
  s: Record<string, number>;
  fnMap?: Record<string, { name: string; loc: Loc }>;
  f?: Record<string, number>;
}

/** `coverage/coverage-final.json` from istanbul / nyc / c8 / vitest / jest. */
export function parseIstanbul(json: unknown): RawCoverage {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new CoverageError('istanbul report is not a JSON object');
  }
  const files = new Map<string, FileCoverage>();

  for (const [key, value] of Object.entries(json)) {
    if (!isIstanbulFile(value)) throw new CoverageError(`istanbul entry for ${key} is malformed`);
    const fc = emptyFile();
    // Line coverage = statement start lines, as istanbul-lib-coverage computes it.
    for (const [id, loc] of Object.entries(value.statementMap)) {
      setHits(fc.lines, loc.start.line, value.s[id] ?? 0);
    }
    for (const [id, fn] of Object.entries(value.fnMap ?? {})) {
      fc.functions.push({
        name: fn.name,
        start: fn.loc.start.line,
        end: fn.loc.end.line,
        hits: value.f?.[id] ?? 0,
      });
    }
    files.set(value.path ?? key, fc);
  }
  return { format: 'istanbul', files };
}

function isIstanbulFile(v: unknown): v is IstanbulFile {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.statementMap === 'object' && o.statementMap !== null && typeof o.s === 'object';
}
