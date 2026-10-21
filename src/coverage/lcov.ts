import { CoverageError, emptyFile, setHits, type FileCoverage, type RawCoverage } from './types.js';

/**
 * `lcov.info` tracefile. Supports both `FN:<line>,<name>` (lcov 1.x) and
 * `FN:<start>,<end>,<name>` (lcov 2.x); repeated SF records for one file are merged.
 */
export function parseLcov(text: string): RawCoverage {
  const files = new Map<string, FileCoverage>();
  let current: FileCoverage | null = null;
  let fnStarts = new Map<string, { start: number; end: number | null }>();
  let fnHits = new Map<string, number>();
  let sawRecord = false;

  const flush = () => {
    if (!current) return;
    for (const [name, span] of fnStarts) {
      current.functions.push({ name, ...span, hits: fnHits.get(name) ?? 0 });
    }
    current = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const colon = line.indexOf(':');
    const tag = colon === -1 ? line : line.slice(0, colon);
    const rest = colon === -1 ? '' : line.slice(colon + 1);

    if (tag === 'SF') {
      flush();
      sawRecord = true;
      const existing = files.get(rest);
      current = existing ?? emptyFile();
      if (!existing) files.set(rest, current);
      fnStarts = new Map();
      fnHits = new Map();
    } else if (tag === 'end_of_record') {
      flush();
    } else if (!current) {
      continue;
    } else if (tag === 'DA') {
      const [ln, hits] = rest.split(',');
      setHits(current.lines, Number(ln), Number(hits));
    } else if (tag === 'FN') {
      const parts = rest.split(',');
      if (parts.length >= 3 && isInt(parts[0]) && isInt(parts[1])) {
        fnStarts.set(parts.slice(2).join(','), { start: Number(parts[0]), end: Number(parts[1]) });
      } else {
        fnStarts.set(parts.slice(1).join(','), { start: Number(parts[0]), end: null });
      }
    } else if (tag === 'FNDA') {
      const comma = rest.indexOf(',');
      const name = rest.slice(comma + 1);
      fnHits.set(name, Math.max(fnHits.get(name) ?? 0, Number(rest.slice(0, comma))));
    }
  }
  flush();

  if (!sawRecord) throw new CoverageError('lcov file has no SF: records');
  return { format: 'lcov', files };
}

function isInt(s: string | undefined): boolean {
  return s !== undefined && /^\d+$/.test(s);
}
