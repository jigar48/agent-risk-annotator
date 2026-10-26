---
name: risk-annotation
description: Use when reviewing, summarizing or approving a large or AI-agent-generated diff, commit, branch or pull request — before writing a review, saying a change looks good, or deciding what to read first. Runs the local risk-annotate CLI to find the hunks that most need a human look (sensitive paths, deleted tests, fix-prone files, uncovered code, new dependencies, lockfile drift, CI/infra changes, outsized diffs).
---

# Risk annotation for agent-generated changes

`risk-annotate` is a local, offline, deterministic CLI. It reads the git repository and prints one line per risky hunk:

```
- L{start}-{end}: [HIGH|MED|LOW] {reason} ({evidence source})
```

Hunks with no signal are omitted. Same input → same output, every time. No code leaves the machine.

## When to use it

- Before reviewing or summarizing a diff of more than a few files, especially one written by a coding agent.
- Before telling the user a change "looks good" or is ready to merge.
- When the user asks where to start reviewing, or what is risky in a change.

Skip it for tiny, single-file edits the user is already looking at.

## How to run it

Prefer `risk-annotate` on PATH; fall back to `npx -y risk-annotate@latest`.

| Situation                                    | Command                                          |
| -------------------------------------------- | ------------------------------------------------ |
| Latest commit                                | `risk-annotate`                                  |
| A branch or PR against its base              | `risk-annotate --base main` (uses `main...HEAD`) |
| A specific commit range                      | `risk-annotate --base <ref> --head <ref>`        |
| With a coverage report not in a default spot | `risk-annotate --coverage path/to/lcov.info`     |
| Machine-readable                             | `risk-annotate --format json`                    |

Project-specific sensitive paths in `.riskannotate.json` at the repository root are picked up automatically, so plain `risk-annotate` is usually right; don't invent `--sensitive-path` flags. Coverage is picked up automatically from `coverage/coverage-final.json`, `coverage/lcov.info`, `lcov.info` or `coverage.json`. Exit code `1` means an error (message on stderr); `2` only happens with `--fail-on`.

## How to read the output

| Evidence              | Meaning                                                                                             | Rule    |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------- |
| `git log`             | File was in a fix/hotfix/revert/incident/bug commit in the last 30 commits                          | A, HIGH |
| `coverage report`     | Changed lines sit in a file or function with 0% coverage                                            | B, MED  |
| `commit size`         | Whole diff is >3× the author's median commit; marks the largest hunk                                | C, LOW  |
| `dependency manifest` | New direct dependency (D, MED) or lockfile/manifest drift (H, MED)                                  | D, H    |
| `path heuristic`      | Auth/crypto/secrets/keys/.env/migrations (E, HIGH); removed test lines (F, HIGH); CI/infra (G, MED) | E, F, G |

## How to act on it

1. Read every `[HIGH]` hunk yourself before forming an opinion on the change.
2. Ground each concern in the code at that range — the annotation tells you where to look, never what is wrong.
3. Report the annotations faithfully: don't re-rank them, invent levels, or drop ones you think are noise. If you disagree with one, say so separately.
4. An empty result (`No risk signals found.`) means no heuristic fired — not that the change is safe.
