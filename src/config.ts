import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_SENSITIVE_PATHS, PatternError, normalizePattern } from './sensitive-paths.js';

/**
 * Optional repository configuration, `.riskannotate.json` at the git top level.
 *
 * Deliberately narrow: it can only add Rule E sensitive-path patterns. Nothing in it can
 * suppress a finding, change a level or disable a rule. The file is read from exactly one
 * place, never followed through a symlink, never evaluated, and any problem with it is an
 * error (exit 1) rather than a silent fallback to defaults.
 */
export const CONFIG_FILE = '.riskannotate.json';
export const CONFIG_VERSION = 1;
export const MAX_CONFIG_BYTES = 32 * 1024;

const KNOWN_KEYS = ['version', 'sensitivePaths'];

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface RepoConfig {
  /** Normalized, deduped and sorted. */
  sensitivePaths: string[];
}

/** Reads `<root>/.riskannotate.json`. Returns null when there is none. */
export function loadConfig(root: string): RepoConfig | null {
  const path = join(root, CONFIG_FILE);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw new ConfigError(`${CONFIG_FILE}: cannot read file (${code ?? 'unknown error'})`);
  }
  if (stat.isSymbolicLink()) {
    throw new ConfigError(
      `${CONFIG_FILE}: is a symbolic link; the configuration must be a regular file at the repository root`,
    );
  }
  if (!stat.isFile()) throw new ConfigError(`${CONFIG_FILE}: is not a regular file`);
  if (stat.size > MAX_CONFIG_BYTES) throw tooLarge(stat.size);
  return parseConfig(readBounded(path));
}

/**
 * Reads at most MAX_CONFIG_BYTES + 1 bytes. O_NOFOLLOW (POSIX) closes the gap between the
 * lstat check and the open; the fstat re-check covers the file being swapped in between.
 * O_NONBLOCK keeps a FIFO swapped in at that moment from hanging the open.
 */
function readBounded(path: string): Uint8Array {
  let fd: number;
  try {
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
    fd = openSync(path, flags);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP') {
      throw new ConfigError(
        `${CONFIG_FILE}: is a symbolic link; the configuration must be a regular file at the repository root`,
      );
    }
    throw new ConfigError(`${CONFIG_FILE}: cannot read file (${code ?? 'unknown error'})`);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new ConfigError(`${CONFIG_FILE}: is not a regular file`);
    if (stat.size > MAX_CONFIG_BYTES) throw tooLarge(stat.size);
    const buf = new Uint8Array(MAX_CONFIG_BYTES + 1);
    let len = 0;
    for (;;) {
      const n = readSync(fd, buf, len, buf.length - len, null);
      if (n === 0) break;
      len += n;
      if (len > MAX_CONFIG_BYTES) throw tooLarge(len);
    }
    return buf.subarray(0, len);
  } finally {
    closeSync(fd);
  }
}

function tooLarge(size: number): ConfigError {
  return new ConfigError(
    `${CONFIG_FILE}: file is larger than ${MAX_CONFIG_BYTES / 1024} KiB (${size} bytes or more)`,
  );
}

/** Validates the raw file bytes against the version 1 schema. */
export function parseConfig(bytes: Uint8Array): RepoConfig {
  const fail = (why: string): never => {
    throw new ConfigError(`${CONFIG_FILE}: ${why}`);
  };

  let text = '';
  try {
    // fatal: invalid UTF-8 is an error, not U+FFFD. A leading BOM is stripped.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('is not valid UTF-8');
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    // The parser's message can quote file content; strip control characters before printing.
    fail(`invalid JSON: ${sanitize((err as Error).message)}`);
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    fail(
      'must contain a JSON object, e.g. { "version": 1, "sensitivePaths": ["src/payments/**"] }',
    );
  }
  const obj = data as Record<string, unknown>;

  // Own keys only: JSON.parse makes "__proto__" an ordinary own key, so it is rejected
  // here as unknown and the parsed object is never merged into anything.
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.includes(key)) {
      fail(
        `unknown property ${quote(key)}; supported properties: ${KNOWN_KEYS.map((k) => `"${k}"`).join(', ')}`,
      );
    }
  }

  if (!Object.hasOwn(obj, 'version'))
    fail(`missing required property "version" (use ${CONFIG_VERSION})`);
  if (obj.version !== CONFIG_VERSION) {
    fail(
      `unsupported version ${quote(obj.version)}; this release of risk-annotate supports version ${CONFIG_VERSION}`,
    );
  }

  if (!Object.hasOwn(obj, 'sensitivePaths')) return { sensitivePaths: [] };
  const raw = obj.sensitivePaths;
  if (!Array.isArray(raw))
    fail(`"sensitivePaths" must be an array of strings (got ${typeName(raw)})`);

  const patterns = (raw as unknown[]).map((entry, i) => {
    const where = `${CONFIG_FILE} sensitivePaths[${i}]`;
    if (typeof entry !== 'string') {
      throw new ConfigError(`${where}: must be a string (got ${typeName(entry)})`);
    }
    // Shell-typed flags can't easily carry these, but a committed file can: C1 controls
    // and bidi overrides could disguise the pattern when it is echoed in a report.
    // C0 controls are left to normalizePattern so both sources share that message.
    if ([...entry].some((ch) => ch.charCodeAt(0) >= 0x7f && isUnsafeChar(ch.charCodeAt(0)))) {
      throw new ConfigError(
        `${where} ${quote(entry)}: control or bidirectional characters are not allowed`,
      );
    }
    try {
      return normalizePattern(entry, where);
    } catch (err) {
      if (err instanceof PatternError) throw new ConfigError(err.message);
      throw err;
    }
  });

  const unique = [...new Set(patterns)].sort();
  if (unique.length > MAX_SENSITIVE_PATHS) {
    fail(
      `at most ${MAX_SENSITIVE_PATHS} unique "sensitivePaths" patterns are allowed (got ${unique.length})`,
    );
  }
  return { sensitivePaths: unique };
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** JSON-quotes a value for an error message, truncated, with C1 controls escaped too. */
function quote(v: unknown): string {
  const s = JSON.stringify(v) ?? String(v);
  return sanitize(s.length > 80 ? `${s.slice(0, 79)}…` : s);
}

/** C0 and C1 controls, DEL, and bidi marks, embeddings, overrides and isolates. */
function isUnsafeChar(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function sanitize(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += isUnsafeChar(code) ? `\\u${code.toString(16).padStart(4, '0')}` : ch;
  }
  return out;
}
