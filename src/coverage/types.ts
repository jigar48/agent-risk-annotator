export type CoverageFormat = 'istanbul' | 'lcov' | 'coverage.py';

export interface FunctionCoverage {
  name: string;
  start: number;
  /** Last line of the function, or null when the format only records where it starts. */
  end: number | null;
  hits: number;
}

export interface FileCoverage {
  /** Instrumented lines only: line number → hit count. Absent lines are not executable. */
  lines: Map<number, number>;
  functions: FunctionCoverage[];
}

/** A coverage file as read, keyed by the paths it contains (slashes normalized). */
export interface RawCoverage {
  format: CoverageFormat;
  files: Map<string, FileCoverage>;
}

export class CoverageError extends Error {
  override name = 'CoverageError';
}

export function emptyFile(): FileCoverage {
  return { lines: new Map(), functions: [] };
}

/** Merges a hit count, keeping the max — matches how istanbul and lcov combine duplicates. */
export function setHits(lines: Map<number, number>, line: number, hits: number): void {
  const prev = lines.get(line);
  if (prev === undefined || hits > prev) lines.set(line, hits);
}
