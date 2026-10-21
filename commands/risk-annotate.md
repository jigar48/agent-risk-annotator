---
description: Annotate the risky hunks in the latest commit (or <base>...HEAD) so you know where to review first
argument-hint: '[base-ref] [--head <ref>] [--coverage <path>]'
allowed-tools: Bash(risk-annotate:*), Bash(npx -y risk-annotate@latest:*), Bash(command -v risk-annotate), Read
---

Run the local, deterministic risk annotator on this repository and walk me through the results.

## 1. Run it

Arguments: `$ARGUMENTS`

- If the first argument does not start with `--`, it is a base ref: pass it as `--base <ref>` and keep the remaining arguments as they are. With no arguments, run with no flags (reviews `HEAD~1..HEAD`).
- Use `risk-annotate` if `command -v risk-annotate` finds it; otherwise use `npx -y risk-annotate@latest`.
- Always use the default Markdown format here.

Exit codes: `0` ran fine, `2` only happens with `--fail-on` and still prints the report, `1` is an error — show the stderr message and stop.

## 2. Show the report

Print the tool's Markdown output exactly as it came back. Do not reword, re-rank or drop annotations; the levels and reasons are the tool's, not yours. If it printed `No risk signals found.`, say so and stop.

## 3. Walk the HIGH annotations first

For each `[HIGH]` bullet, in order:

1. Read that file at the annotated line range (a little context around it is fine).
2. In one or two sentences, say what specifically a reviewer should verify there, grounded in the code you just read and the annotation's reason.

Then list the `[MED]` and `[LOW]` items in one short line each, without opening the files, and ask whether I want to go through any of them.

## Rules for this command

- The annotations say **where to look**, not whether the code is wrong. Never call a change safe or unsafe based on the annotation alone.
- Do not edit any files unless I ask.
- Evidence sources mean: `git log` = the file was in a recent fix/revert commit; `coverage report` = changed lines no test runs; `commit size` = much larger than this author's usual commit; `dependency manifest` = new dependency or lockfile drift; `path heuristic` = sensitive path, deleted test lines, or CI/infra file.
