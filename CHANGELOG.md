# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/jigar48/agent-risk-annotator/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jigar48/agent-risk-annotator/releases/tag/v0.1.0
