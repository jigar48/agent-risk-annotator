# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Optional repository configuration, `.riskannotate.json` at the git repository root:
  `{ "version": 1, "sensitivePaths": [...] }`. Its patterns are combined with
  `--sensitive-path` flags (deduplicated and sorted, so output stays deterministic) and flag
  matching files HIGH under Rule E. The file can only add sensitive paths; it cannot
  suppress findings, change levels or disable rules. Without the file nothing changes, and
  a config produces output identical to passing the same patterns as flags.

### Security

- The config fails closed: malformed JSON, invalid UTF-8, unknown properties (including
  `__proto__`), a `version` other than `1`, invalid patterns, more than 100 unique patterns
  (config and flags combined), files over 32 KiB, symlinks and non-regular files exit 1
  with a message naming the problem. Control and bidirectional characters are escaped in
  messages and rejected in config patterns.

## [0.2.0] - 2026-10-23

### Added

- `--sensitive-path <glob>` (repeatable): flag project-specific paths HIGH under Rule E, on
  top of the built-in patterns. Supports `*`, `**` and `?`; repo-relative; checks old and new
  paths of renames; Windows `\` separators accepted. Patterns are normalized, deduplicated
  and sorted so flag order never changes the output. Invalid patterns (absolute, `..`,
  braces/brackets, negation, `**` inside a segment, control characters, over 256 chars or
  more than 100 patterns) exit 1 with a message naming the pattern.

### Security

- Replaced the regex-based glob matcher with one that uses no regular expressions. The old
  matcher could backtrack polynomially on patterns with many `*` (about 1.9 s for one match
  with 12 stars). Built-in patterns were not affected, but user-supplied patterns would
  have been. Matching is now bounded by pattern length × path length, with a regression test.

## [0.1.0] - 2026-10-21

### Added

- `risk-annotate` CLI: one Markdown bullet per risky hunk,
  `- L{start}-{end}: [LEVEL] reason (evidence)`, with `--format json` (schema v1) and
  `--format sarif` (2.1.0).
- Rules A–H: fix-prone files (git log), uncovered code (istanbul, lcov, coverage.py JSON),
  outsized diffs relative to the author's median, new dependencies, sensitive paths,
  deleted test lines, CI/infra changes, and lockfile/manifest drift.
- `--base`/`--head` ranges with an empty-tree fallback for root commits, `--fail-on`
  (exit 2), `--coverage`, `--cwd`.
- Claude Code plugin: `/risk-annotate` command and `risk-annotation` skill.
- Composite GitHub Action with job summary, optional SARIF upload and `fail-on` gating.
- Release workflow: Bun single binaries for linux-x64, darwin-arm64, darwin-x64 and
  windows-x64 with `SHA256SUMS`, and npm publishing with provenance.

[Unreleased]: https://github.com/jigar48/agent-risk-annotator/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/jigar48/agent-risk-annotator/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jigar48/agent-risk-annotator/releases/tag/v0.1.0
