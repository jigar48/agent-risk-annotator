# agent-risk-annotator

**Annotate the risk signals in AI-agent-generated changes so developers know where to look first when reviewing.**

[![CI](https://github.com/jigar48/agent-risk-annotator/actions/workflows/ci.yml/badge.svg)](https://github.com/jigar48/agent-risk-annotator/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/risk-annotate)](https://www.npmjs.com/package/risk-annotate)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-buildwithjigar-FFDD00?logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/buildwithjigar)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Jigar%20Prajapati-0A66C2?logo=linkedin)](https://www.linkedin.com/in/buildaiwith-jigar-prajapati/)

Coding agents hand you large diffs. `risk-annotate` reads your git repository and prints **one line per risky hunk** — sensitive paths, deleted tests, fix-prone files, uncovered code, new dependencies, lockfile drift, CI/infra changes, outsized diffs — so you review the dangerous parts first.

![A 7-file agent diff in git order becomes a ranked review list: 3 HIGH, 3 MED and 1 LOW, each with its reason and evidence](https://raw.githubusercontent.com/jigar48/agent-risk-annotator/main/docs/images/how-it-helps.svg)

- **Local-first.** Runs entirely on your machine. No network calls, no telemetry, no code leaves the repo.
- **Deterministic.** Rule-based heuristics only. Same input, same output, byte for byte.
- **Model-agnostic.** Works on any diff, whichever agent (or human) wrote it.
- **Cites its evidence.** Every annotation names where the signal came from.

## See it in action

The same change in your terminal — then gating CI on it with `--fail-on`:

![risk-annotate output: a ranked, colour-coded report with one line per risky hunk, then exit code 2 from --fail-on high](https://raw.githubusercontent.com/jigar48/agent-risk-annotator/main/docs/images/terminal.svg)

And inside Claude Code, where `/risk-annotate` runs the tool, prints the report verbatim and walks you through it:

![A real /risk-annotate session in Claude Code: the report for the latest commit, then a short summary of each MED item and a question about which to review](https://raw.githubusercontent.com/jigar48/agent-risk-annotator/main/docs/images/claude-code-session.webp)

<details>
<summary>The terminal report as text</summary>

```markdown
# Risk annotations

`HEAD~1..HEAD` · 7 files · 3 HIGH · 3 MED · 1 LOW

## `src/a.test.ts`

- L1-1: [HIGH] Removes 2 test lines; confirm coverage was not dropped to make the suite pass (path heuristic)

## `src/a.ts`

- L5-5: [HIGH] File was in fix/revert commit 9666a75 within the last 5 commits; it has regressed before (git log)

## `src/auth/login.ts`

- L5-5: [HIGH] Touches auth code; check session, token and permission handling (path heuristic)

## `.github/workflows/ci.yml`

- L1-1: [MED] CI workflow changed; check permissions, secret usage and triggers (path heuristic)

## `package.json`

- L5-6: [MED] Adds new dependency "zod"; review provenance, license and maintenance (dependency manifest)

## `src/uncovered.ts`

- L3-3: [MED] Changes a file with 0% test coverage; no test exercises these lines (coverage report)

## `src/big.ts`

- L1-20: [LOW] Diff is 32 lines, 8.0x this author's median of 4 over 5 commits; consider splitting (commit size)
```

</details>

The terminal and diagram images are generated from the tool's real output on the test fixture (`npm run docs:images`), so they always match what the CLI prints.

## Install

| How                                | Command                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Run without installing (Node 20+)  | `npx risk-annotate`                                                                                                                                                |
| Install globally                   | `npm install -g risk-annotate`                                                                                                                                     |
| Standalone binary (no Node needed) | Download `risk-annotate-<os>-<arch>` from [Releases](https://github.com/jigar48/agent-risk-annotator/releases), verify against `SHA256SUMS`, put it on your `PATH` |
| Claude Code plugin                 | `/plugin marketplace add jigar48/agent-risk-annotator` then `/plugin install agent-risk-annotator@agent-risk-annotator`                                            |
| GitHub Action                      | [`uses: jigar48/agent-risk-annotator@v0`](#github-action)                                                                                                          |

Requires `git` on `PATH`.

## Usage

```bash
risk-annotate                          # review the latest commit (HEAD~1..HEAD)
risk-annotate --base main              # review a branch: main...HEAD (since it diverged)
risk-annotate --base v1.2.0 --head v1.3.0
risk-annotate --format json            # machine-readable
risk-annotate --fail-on high           # exit 2 if anything is HIGH (for CI)
risk-annotate --sensitive-path 'src/payments/**'   # also flag your own risky paths HIGH
```

Commit a [`.riskannotate.json`](#repository-configuration-riskannotatejson) to share those paths with your team instead of repeating the flag.

| Flag                      | Default     | Meaning                                                                                                                      |
| ------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--base <ref>`            | —           | Compare `<base>...<head>` (from the merge base). Without it: `<head>~1..<head>`                                              |
| `--head <ref>`            | `HEAD`      | Revision under review                                                                                                        |
| `--format <fmt>`          | `markdown`  | `markdown`, `json` or `sarif`                                                                                                |
| `--fail-on <level>`       | —           | Exit `2` if any annotation is at or above `high`, `med` or `low`                                                             |
| `--coverage <path>`       | auto-detect | Coverage file to use (see [Coverage](#coverage))                                                                             |
| `--sensitive-path <glob>` | —           | Extra path to flag HIGH under Rule E. Repeatable (see [Project-specific sensitive paths](#project-specific-sensitive-paths)) |
| `--cwd <dir>`             | `.`         | Run against the repository containing `<dir>`                                                                                |
| `-v`, `--version`         |             | Print the version                                                                                                            |
| `-h`, `--help`            |             | Print help                                                                                                                   |

On a repository's very first commit there is no `HEAD~1`; the whole commit is compared against git's empty tree.

## Output format

One `##` section per changed file. Under each, one bullet per risky hunk:

```
- L{start}-{end}: [{LEVEL}] {one-line reason} ({evidence source})
```

- **`LEVEL`** is `HIGH`, `MED` or `LOW` — three levels, no scores.
- **Reason** is one sentence of at most 120 characters: what was detected and why it matters.
- **Evidence source** is one of `git log`, `coverage report`, `commit size`, `dependency manifest`, `path heuristic`.
- **Line ranges** are inclusive, 1-indexed, in the **new** version of the file.
- **Hunks with no signal are omitted.** If nothing fires, the output is `No risk signals found.`

Files are ordered by their highest level, then path. When several rules fire on one hunk, the bullet shows the highest level; ties go to the earlier rule (A before H). JSON and SARIF keep every signal.

A few edge cases:

- A pure deletion has no lines in the new file, so it is reported at the line it follows (`L1-1` at the top of a file or for a deleted file).
- Files with no text hunks — binary files, pure renames, mode changes — get a single `L1-1` annotation so file-level rules (a changed `*.key`, a renamed `.env`) still report.

## Rules

| Rule                 | Detects                                                                                                                                                                               | Level | Evidence              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------- |
| **A** Fix-prone file | The file appears in a commit whose subject matches `/fix\|hotfix\|revert\|incident\|bug/i` within the 30 commits before the change                                                    | HIGH  | `git log`             |
| **B** Uncovered code | Changed lines inside a file or function with 0% coverage. Silent without a coverage report                                                                                            | MED   | `coverage report`     |
| **C** Outsized diff  | Total diff lines > 3× the median of the head author's last 10 commits before the change (matched by email). Reported once, on the largest hunk. Needs ≥ 3 prior commits               | LOW   | `commit size`         |
| **D** New dependency | A new direct dependency in `package.json`, `composer.json`, `requirements*.txt`, `pyproject.toml`, `Cargo.toml` or `go.mod`; names the dependency                                     | MED   | `dependency manifest` |
| **E** Sensitive path | `**/auth/**`, `**/crypto/**`, `**/secrets/**`, `*.pem`, `*.key`, `.env*`, `**/migrations/**`, plus project patterns from `--sensitive-path` or `.riskannotate.json` (old or new path) | HIGH  | `path heuristic`      |
| **F** Deleted tests  | Any hunk that removes lines from `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.go`                                                                                                     | HIGH  | `path heuristic`      |
| **G** CI/infra       | `.github/workflows/**`, `Dockerfile*`, `docker-compose*`, `**/terraform/**`, `**/k8s/**`                                                                                              | MED   | `path heuristic`      |
| **H** Lockfile drift | A lockfile changed with no change to its manifest, or a manifest's dependencies changed while its lockfile didn't (npm/yarn/pnpm/bun, composer, poetry/uv, cargo, go)                 | MED   | `dependency manifest` |

Notes on behaviour:

- **History means "before the change".** Rules A and C look at commits before the one under review (before the merge base with `--base`), so an agent commit titled "fix everything" doesn't flag itself.
- **Rule A matches subjects as substrings**, exactly as specified — `debug` and `prefix` count. It looks back at most 30 commits.
- **Rule F flags edits, not just removals.** Rewriting an assertion removes a line, so it is flagged; the reason says "Rewrites" rather than "Removes".
- **Rule H is workspace-aware.** A root `pnpm-lock.yaml` is explained by a change to any nested `package.json`, and a nested manifest is covered by the nearest lockfile above it. Manifest edits that don't touch dependencies (scripts, metadata) are ignored, as are projects with no lockfile.
- **Unparseable manifests and ambiguous coverage paths make rules stay silent** rather than guess.

## Project-specific sensitive paths

The built-in Rule E patterns know about `auth/`, `crypto/`, keys and migrations — not about _your_ checkout flow, payment adapters or permission checks. Add your own with `--sensitive-path`, or commit them in [`.riskannotate.json`](#repository-configuration-riskannotatejson); matching files are flagged HIGH under Rule E, alongside every built-in pattern.

```bash
risk-annotate --sensitive-path 'src/payments/**' --sensitive-path '**/webhooks/*.ts'
```

Always quote patterns, or your shell may expand `*` before risk-annotate sees it.

### Example: a synthetic Next.js storefront

An agent adds coupon support: one line in the checkout route zeroes the order total when a coupon is present, a payment call changes, and `middleware.ts` gains an early return that skips the session check for `/api/health`. None of these paths match a built-in pattern:

```text
$ npx risk-annotate
No risk signals found.
```

With three project-specific patterns, the same commit (real output):

```text
$ npx risk-annotate --sensitive-path 'app/api/checkout/**' --sensitive-path 'lib/payments/**' --sensitive-path middleware.ts
# Risk annotations

`HEAD~1..HEAD` · 3 files · 3 HIGH · 0 MED · 0 LOW

## `app/api/checkout/route.ts`

- L3-3: [HIGH] Matches project sensitive path `app/api/checkout/**`; review with extra care (path heuristic)

## `lib/payments/stripe.ts`

- L2-2: [HIGH] Matches project sensitive path `lib/payments/**`; review with extra care (path heuristic)

## `middleware.ts`

- L2-2: [HIGH] Matches project sensitive path `middleware.ts`; review with extra care (path heuristic)
```

The annotations point at where to look; they don't say the coupon logic is wrong. That judgment is the reviewer's.

### More starting points

| Stack                | Patterns                                                                             |
| -------------------- | ------------------------------------------------------------------------------------ |
| Next.js              | `'app/api/**'` `'middleware.ts'` `'next.config.*'` `'lib/payments/**'`               |
| Django               | `'settings.py'` `'**/settings/**'` `'**/permissions.py'` `'**/views/payment*.py'`    |
| Magento / e-commerce | `'app/code/**/Payment/**'` `'**/Checkout/**'` `'**/webhooks/**'` `'app/etc/env.php'` |
| Data / ML pipelines  | `'pipelines/**/export*.py'` `'**/pii/**'` `'dags/**/billing*.py'`                    |

### Syntax

| Pattern               | Matches                                                                                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*`                   | Any run of characters within one path segment (never crosses `/`)                                                                                                                                                     |
| `?`                   | Exactly one character within a segment                                                                                                                                                                                |
| `**`                  | Any number of directories, as a whole segment: `src/**/x.ts` matches `src/x.ts` and `src/a/b/x.ts`. At the end (`src/**`) it needs at least one level below, so it matches files under `src/`, not a file named `src` |
| `name` (no `/`)       | That file name in any directory, like `.gitignore`: `settings.py` matches `mysite/settings.py`                                                                                                                        |
| `dir/` (trailing `/`) | Everything under `dir`, same as `dir/**`                                                                                                                                                                              |

- Patterns are **repository-relative** and **case-sensitive**, like git's own paths. A leading `./` is ignored, and Windows-style `\` separators are converted to `/`.
- Both the old and new path of a renamed file are checked, so moving a file out of a sensitive directory is still flagged.
- When a file matches a built-in pattern and a custom one, the more specific built-in reason is shown. Among custom patterns, the first in sorted order is named, so the order of your flags never changes the output.
- Duplicates are removed. Up to 100 unique patterns (flags and config file combined) of up to 256 characters each are accepted.
- Rejected with exit code `1` and a message naming the pattern: absolute paths (`/x`, `C:\x`), `..` or `.` segments, `**` inside a segment (`a**b`), brackets and braces (`[ab]`, `{a,b}` — repeat the flag instead), negation (`!x`), backticks, control characters, and empty or whitespace-padded patterns.

### Limitations and security notes

- **Path-based only.** A pattern says _where_ risk lives; it can't see what the code does. A risky change outside your patterns, or a harmless one inside them, is reported accordingly. This is not a security scan and does not guarantee that vulnerabilities are found.
- **Patterns never leave the process.** They are compared against path strings from `git diff`; they are not passed to git, a shell or the filesystem, so they cannot read files, escape the repository or run commands.
- **Bounded matching.** The matcher uses no regular expressions; its work is bounded by pattern length × path length, so adversarial patterns cannot cause catastrophic backtracking (ReDoS). There's a regression test for this.
- **Nothing is persisted or sent anywhere.** The pattern list isn't stored as its own field in JSON or SARIF; only the annotation's reason names the pattern that matched, so those formats are unchanged in shape. To reuse a set of patterns, commit them in [`.riskannotate.json`](#repository-configuration-riskannotatejson).

### Repository configuration: `.riskannotate.json`

Commit the patterns once and everyone — teammates, CI, the Claude Code command — gets the same annotations without remembering any flags:

```json
{
  "version": 1,
  "sensitivePaths": ["src/payments/**", "src/checkout/**", "**/webhooks/*.ts"]
}
```

- **Discovery.** risk-annotate reads `.riskannotate.json` from the root of the git repository (`git rev-parse --show-toplevel`), so it is found whether you run from the root, a nested directory, or with `--cwd`. Files of the same name in subdirectories or parent directories are ignored. It is a plain read of the working-tree file: it doesn't have to be committed, and it is not read from the `--head` or `--base` revision.
- **No file, no change.** Without a config, behavior and output are exactly as before. `{ "version": 1 }` and an empty `sensitivePaths` list are also no-ops.
- **Schema (version 1).** `version` is required and must be `1`. `sensitivePaths` is an optional array of strings using the [same syntax and validation](#syntax) as `--sensitive-path`. Any other property is an error. There are no comments, includes, variables or environment-variable expansion.
- **Combined with flags.** Config patterns and `--sensitive-path` flags are merged into one list, normalized, deduplicated and sorted, so neither source takes precedence and the order of entries never changes the output. Flags can only add patterns; nothing removes a config entry or a built-in pattern for one run. At most 100 unique patterns are allowed across both sources.
- **Additive only.** The file can add sensitive paths and nothing else: it cannot suppress findings, change levels or disable rules. Built-in Rule E patterns keep their more specific reasons.
- **Same output as flags.** A config is byte-for-byte equivalent to passing the same patterns as flags, in Markdown, JSON and SARIF. The JSON schema and SARIF rules are unchanged.
- **Fails closed.** A config that is malformed JSON, not valid UTF-8, has an unknown property, an unsupported `version`, a non-string or invalid pattern, more than 100 unique patterns, or is larger than 32 KiB is an error: exit code `1`, a message on stderr naming the problem (and the array index for patterns), and no report. It is never silently ignored.

```text
$ risk-annotate
risk-annotate: .riskannotate.json sensitivePaths[1] "../shared/**": ".." segments are not allowed; patterns match paths inside the repository
```

#### Example: a synthetic e-commerce shop

An agent's "add coupon support" commit zeroes the order total whenever a coupon is present, drops the idempotency key from a payment call, makes a webhook signature check always pass, and changes a catalog sort order. None of these paths match a built-in pattern, so without configuration:

```text
$ risk-annotate
No risk signals found.
```

With the `.riskannotate.json` above at the repository root, the same commit (real output):

```text
$ risk-annotate
# Risk annotations

`HEAD~1..HEAD` · 3 files · 3 HIGH · 0 MED · 0 LOW

## `api/webhooks/stripe.ts`

- L2-2: [HIGH] Matches project sensitive path `**/webhooks/*.ts`; review with extra care (path heuristic)

## `src/checkout/total.ts`

- L3-3: [HIGH] Matches project sensitive path `src/checkout/**`; review with extra care (path heuristic)

## `src/payments/charge.ts`

- L2-2: [HIGH] Matches project sensitive path `src/payments/**`; review with extra care (path heuristic)
```

The catalog change isn't flagged, and nothing here says the coupon, payment or webhook code is wrong — the annotations say where a reviewer should look first. A one-off extra path still works as a flag and is added on top: `risk-annotate --sensitive-path 'src/catalog/**'`.

#### Team usage

1. Commit `.riskannotate.json` at the root of the repository you review.
2. Treat it like other review policy: list it in `CODEOWNERS` so changes to it need a lead or security reviewer.
3. Everyone runs plain `risk-annotate`, `/risk-annotate` in Claude Code, or the GitHub Action — all pick it up automatically.

#### In CI

The [GitHub Action](#github-action) needs no new inputs; it reads `.riskannotate.json` from the checkout. Because the file comes from the checked-out working tree, a pull request can edit it. To judge every PR by the configuration on its base branch instead, restore that copy before running:

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0
- name: Use the base branch's risk configuration
  if: github.event_name == 'pull_request'
  env:
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
  run: git checkout "$BASE_SHA" -- .riskannotate.json 2>/dev/null || rm -f .riskannotate.json
- uses: jigar48/agent-risk-annotator@v0
  with:
    fail-on: high
```

#### Security notes for the config file

- **Bounded input.** At most 32 KiB, 100 unique patterns and 256 characters per pattern. Patterns go through the same regex-free matcher as flags, so a hostile config cannot cause catastrophic backtracking (ReDoS).
- **One fixed location, no traversal.** Only `<repo root>/.riskannotate.json` is opened. Patterns are compared against path strings from `git diff` and never touch the filesystem; absolute paths and `..` segments are rejected.
- **No symlinks.** A symlinked `.riskannotate.json` is rejected, even one pointing at a valid file, so the config cannot be redirected to a file elsewhere on the machine. On Linux and macOS the open also uses `O_NOFOLLOW`. Directories and other non-regular files are rejected too.
- **Data only.** The file is parsed with `JSON.parse`: no code is evaluated, no shell runs, no environment variables are expanded, nothing is fetched over the network and no other files are included. Unknown keys, including `__proto__` and `constructor`, are rejected, and the parsed object is never merged into anything.
- **Safe error messages.** Control characters and Unicode bidirectional overrides from the file are escaped in error messages and rejected inside patterns, so a malicious config cannot spoof terminal output or disguise a pattern in a report.
- **A pull request can change it.** The config comes from the working tree under review, so a branch can add, remove or loosen patterns in the same change. Use `CODEOWNERS` and/or the base-branch step above if that matters for your repository.
- **Case-insensitive filesystems** (the default on Windows and macOS) may also open a file named, for example, `.RiskAnnotate.json`. Patterns themselves are always case-sensitive, like git paths.

## Coverage

Rule B uses a coverage report if one is present. Auto-detection checks, in order, from the repository root:

1. `coverage/coverage-final.json` — istanbul / nyc / c8 / vitest / jest
2. `coverage/lcov.info`
3. `lcov.info`
4. `coverage.json` — coverage.py, from `coverage json`

Or pass `--coverage <path>`. An explicit path that is missing or unreadable is an error; a broken auto-detected file is skipped with a warning on stderr.

- coverage.py's binary `.coverage` file is **not** read (it is SQLite and would need a native dependency). Run `coverage json` to produce `coverage.json`. Per-function data needs coverage.py 7.5+; older reports give file-level results only.
- Report paths are matched to repository paths whether they are absolute, relative to a monorepo package, or from another machine (e.g. CI). Ambiguous matches are ignored.
- **The report should describe the code at `--head`.** A stale report gives wrong line matches, and nothing in the files can detect that.

## Exit codes

| Code | Meaning                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| `0`  | Success (with or without annotations)                                                                                          |
| `1`  | Error: bad flag, unknown revision, not a git repository, missing or unreadable `--coverage` file, invalid `.riskannotate.json` |
| `2`  | `--fail-on` threshold reached. The report is still printed                                                                     |

## JSON and SARIF

`--format json` prints a stable report (`schemaVersion: 1`) with the range, a per-level summary, and every signal per hunk. It contains no timestamps, so identical input gives identical bytes. Additive changes stay within a schema version; breaking ones bump it.

`--format sarif` prints SARIF 2.1.0 for GitHub code scanning: rules `RA-A` … `RA-H`, one result per signal, `HIGH`→`error`, `MED`→`warning`, `LOW`→`note`.

## GitHub Action

```yaml
name: Risk annotations
on: pull_request

jobs:
  annotate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0 # rules A and C, and --base, need history
      - uses: jigar48/agent-risk-annotator@v0
```

The report lands in the job summary. On pull requests the PR's base commit is used automatically. To gate merges and surface annotations in code scanning:

```yaml
permissions:
  contents: read
  security-events: write
steps:
  - uses: actions/checkout@v7
    with:
      fetch-depth: 0
  - uses: jigar48/agent-risk-annotator@v0
    with:
      fail-on: high
      upload-sarif: true
```

| Input          | Default                    | Meaning                                                              |
| -------------- | -------------------------- | -------------------------------------------------------------------- |
| `base`         | PR base SHA, else `head~1` | Base ref                                                             |
| `head`         | `HEAD`                     | Revision under review                                                |
| `fail-on`      | —                          | Fail the job at or above `high` / `med` / `low`                      |
| `coverage`     | auto-detect                | Coverage file path                                                   |
| `upload-sarif` | `false`                    | Upload SARIF to code scanning                                        |
| `version`      | `latest`                   | npm version of `risk-annotate` to run                                |
| `cli`          | —                          | Path to a local build to run instead of npm (for testing the action) |

A `.riskannotate.json` in the checkout is picked up automatically (see [In CI](#in-ci) to pin it to the PR's base branch).

Outputs: `exit-code` (`0` or `2`) and `report` (path to the Markdown report). The action only installs Node if the runner lacks Node 20+, and it fails as its last step so the summary and SARIF are published even when the threshold is hit.

## Claude Code plugin

```
/plugin marketplace add jigar48/agent-risk-annotator
/plugin install agent-risk-annotator@agent-risk-annotator
```

- **`/risk-annotate [base-ref]`** runs the CLI, shows the report verbatim, then walks each HIGH hunk and says what to verify there.
- **The `risk-annotation` skill** prompts Claude to run the annotator before reviewing, summarizing or approving a large or agent-generated diff.

Annotations tell you **where to look**, never what is wrong. An empty result means no heuristic fired, not that the change is safe.

## Roadmap

- **Shipped (unreleased) — `.riskannotate.json` version 1.** A deliberately narrow first slice: persisted `sensitivePaths` only, additive and strictly validated.
- **Broader configuration (future, not committed to).** Candidates for a later config version: per-rule level overrides, ignore globs, history-window sizes, a coverage path, and a YAML form. Anything that could hide or downgrade a signal needs careful design (for example, staying visible in the report), so none of it is in version 1.
- **Opt-in LLM pass.** The rule engine has a marked `// EXTENSION POINT: llm-pass` where an optional model pass could add signals with its own evidence source. It will never remove or reorder heuristic signals, and it will stay off by default so the local, deterministic core is unchanged.
- More manifest ecosystems for rules D and H (Pipfile, Gemfile, Gradle, Maven).

## Development

```bash
npm ci
npm test              # vitest; builds throwaway git repos in your temp dir
npm run lint
npm run typecheck
npm run build         # dist/cli.js
npm run compile       # single binary via Bun (requires bun)
```

Golden files for all three output formats live in `test/golden/`. After an intentional output change, run `npx vitest run -u` and review the diff.

## About the author

Built by **Jigar Prajapati**, a freelance software developer and automation engineer in Ahmedabad, India, specializing in API integrations, e-commerce systems, cloud infrastructure, and AI agents (Python, Playwright, FastAPI, AWS, TypeScript).

Available for custom software development, API integrations, e-commerce solutions, and AI automation consulting.

- GitHub: [github.com/jigar48](https://github.com/jigar48)
- Portfolio: [jigar48.github.io/automatewithjigar](https://jigar48.github.io/automatewithjigar/)
- LinkedIn: [Jigar Prajapati](https://www.linkedin.com/in/buildaiwith-jigar-prajapati/)
- Email: [jigar.prajapati48@gmail.com](mailto:jigar.prajapati48@gmail.com)

### More local-first developer tools

| Project                                                           | What it does                                                                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [awi](https://github.com/jigar48/awi)                             | Local-first linter for AI agent traces. Detects retry loops, repeated tool calls, execution cycles, and suspicious resource burn. |
| [api-contract-diff](https://github.com/jigar48/api-contract-diff) | Catches removed endpoints, response fields, and type changes between local OpenAPI specs, with CI-friendly exit codes.            |
| [mcp-agentmesh](https://github.com/jigar48/mcp-agentmesh)         | Single-file multi-agent utility coordinating System Architect, Coder, and Security Auditor sub-agents locally.                    |

## Support my work

If risk-annotate saves you review time, you can buy me a coffee. Support is optional; issue reports and feedback are just as welcome.

<a href="https://buymeacoffee.com/buildwithjigar"><img src="https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png" alt="Buy me a coffee" height="41"></a>

## License

[MIT](LICENSE) © 2026 Jigar
