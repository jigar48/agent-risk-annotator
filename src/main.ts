import { parseArgs } from 'node:util';
import { CONFIG_FILE, ConfigError } from './config.js';
import { buildContext } from './context.js';
import { CoverageError } from './coverage/index.js';
import { FORMATS, render, type Format } from './format/index.js';
import { GitError } from './git.js';
import { annotate } from './rules/engine.js';
import { LEVEL_RANK, type Level } from './rules/types.js';
import { normalizeSensitivePaths, PatternError } from './sensitive-paths.js';
import { VERSION } from './version.js';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_FAIL_ON = 2;

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  cwd: string;
}

export const HELP = `risk-annotate ${VERSION}
Annotate the risk signals in AI-agent-generated changes so you know where to look first.

Usage:
  risk-annotate [options]

Options:
  --base <ref>        Compare <base>...<head> (merge base). Default: <head>~1..<head>
  --head <ref>        Revision under review. Default: HEAD
  --format <fmt>      markdown | json | sarif. Default: markdown
  --fail-on <level>   Exit 2 if any annotation is at or above high | med | low
  --coverage <path>   Coverage file (istanbul JSON, lcov, coverage.py JSON).
                      Default: auto-detect in the repo root
  --sensitive-path <glob>
                      Extra repo-relative path to flag HIGH (Rule E), on top of the
                      built-ins. Repeatable. Supports *, ** and ?. Quote it in your shell.
                      Combined with "sensitivePaths" from ${CONFIG_FILE}.
  --cwd <dir>         Run against the repository containing <dir>. Default: .
  -v, --version       Print the version
  -h, --help          Print this help

Configuration:
  ${CONFIG_FILE} at the repository root is read when present:
    { "version": 1, "sensitivePaths": ["src/payments/**"] }
  It can only add sensitive paths. An invalid file is an error (exit 1).

Exit codes:
  0  success
  1  error (bad flag, unknown revision, unreadable coverage file, not a git repo,
     invalid ${CONFIG_FILE})
  2  --fail-on threshold reached
`;

/** Whole CLI as a pure-ish function: argv in, exit code out, output via `io`. */
export function main(argv: readonly string[], io: Io): number {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        base: { type: 'string' },
        head: { type: 'string' },
        format: { type: 'string', default: 'markdown' },
        'fail-on': { type: 'string' },
        coverage: { type: 'string' },
        'sensitive-path': { type: 'string', multiple: true },
        cwd: { type: 'string' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (err) {
    return usageError(io, (err as Error).message);
  }

  if (values.help) {
    io.stdout(HELP);
    return EXIT_OK;
  }
  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return EXIT_OK;
  }

  const format = values.format as Format;
  if (!FORMATS.includes(format)) {
    return usageError(
      io,
      `--format must be one of: ${FORMATS.join(', ')} (got "${values.format}")`,
    );
  }

  let failOn: Level | undefined;
  if (values['fail-on'] !== undefined) {
    const lvl = values['fail-on'].toUpperCase();
    const normalized = lvl === 'MEDIUM' ? 'MED' : lvl;
    if (!(normalized in LEVEL_RANK)) {
      return usageError(
        io,
        `--fail-on must be one of: high, med, low (got "${values['fail-on']}")`,
      );
    }
    failOn = normalized as Level;
  }

  let sensitivePaths: string[];
  try {
    sensitivePaths = normalizeSensitivePaths(values['sensitive-path'] ?? []);
  } catch (err) {
    if (err instanceof PatternError) return usageError(io, err.message);
    throw err;
  }

  try {
    const ctx = buildContext({
      cwd: values.cwd ?? io.cwd,
      base: values.base,
      head: values.head,
      coveragePath: values.coverage,
      sensitivePaths,
    });
    for (const w of ctx.warnings) io.stderr(`risk-annotate: warning: ${w}\n`);

    const files = annotate(ctx);
    io.stdout(render(format, files, { range: ctx.range, warnings: ctx.warnings }));

    if (failOn) {
      const threshold = LEVEL_RANK[failOn];
      const hit = files.some((f) => f.hunks.some((h) => LEVEL_RANK[h.top.level] >= threshold));
      if (hit) {
        io.stderr(`risk-annotate: found annotations at or above ${failOn}\n`);
        return EXIT_FAIL_ON;
      }
    }
    return EXIT_OK;
  } catch (err) {
    if (
      err instanceof GitError ||
      err instanceof CoverageError ||
      err instanceof ConfigError ||
      err instanceof PatternError
    ) {
      io.stderr(`risk-annotate: ${err.message}\n`);
    } else {
      const e = err as Error;
      io.stderr(`risk-annotate: unexpected error: ${e.message}\n`);
      if (process.env.RISK_ANNOTATE_DEBUG) io.stderr(`${e.stack ?? ''}\n`);
    }
    return EXIT_ERROR;
  }
}

function usageError(io: Io, message: string): number {
  io.stderr(`risk-annotate: ${message}\nRun "risk-annotate --help" for usage.\n`);
  return EXIT_ERROR;
}
