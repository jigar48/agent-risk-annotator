# Contributing

Thanks for helping make reviews of agent-generated changes faster. Bug reports, false-positive reports and rule ideas are as welcome as code.

## Run the suite

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
```

Tests create throwaway git repositories in your OS temp directory; no network or credentials are needed.

## Add a rule

1. **Create `src/rules/<letter>-<name>.ts`** exporting a `Rule` (see `src/rules/types.ts`):
   - `id` — the rule letter. A new letter must also be added to the `RuleId` union.
   - `title` — short name, used in SARIF.
   - `checkFile(file, ctx)` for whole-file signals (the engine pins them to the file's first hunk), or `checkHunk(file, hunk, ctx)` for per-hunk signals. Return `SignalDraft[]`: `{ level, reason, evidence }`.
   - `reason` is one sentence, at most 120 characters, saying what was detected and why it matters.
   - `evidence` must be one of the existing sources (`git log`, `coverage report`, `commit size`, `dependency manifest`, `path heuristic`). A new source needs an issue first.
   - Rules must be deterministic and read only from `RepoContext` — no network, no clock, no randomness.
2. **Register it** in `src/rules/index.ts`. Array order is the tie-break order when two signals share a level.
3. **Describe it** in the `DESCRIPTIONS` map in `src/format/sarif.ts` (typecheck fails until you do) and in the README rules table.
4. **Test it** in `test/rules/<letter>-<name>.test.ts`. Every rule needs at least:
   - a **fires** case,
   - a **doesn't-fire** case (the near miss a real repo would produce),
   - a **boundary** case (the exact threshold, window edge or pattern edge).

   Use `createRepo()` from `test/helpers/repo.ts` to script real commits (commit dates are pinned, so hashes are stable), or `fakeContext()`/`change()`/`hunk()` from `test/helpers/context.ts` for rules that only look at paths and hunks. Assert reasons stay within `MAX_REASON`.

## Golden files

`test/golden/` holds the exact Markdown, JSON and SARIF output for a fixture that trips every rule (`test/helpers/fixture.ts`). If you intentionally change output, run `npx vitest run -u` and review the golden-file diff in your PR. Unexplained golden changes won't be merged.

## The hard constraint: no runtime dependencies

`dependencies` in `package.json` stays empty. That keeps `npx risk-annotate` fast, the Bun binary self-contained and the supply chain small. If a rule needs a parser, write a minimal one inline (see `src/manifests.ts`), or open an issue proposing a dev dependency first.

## Report a false positive

Open an issue with:

- the diff (or a minimal repo that reproduces it),
- the annotation you expected (or "none"),
- the annotation you got, copied verbatim from the output.
