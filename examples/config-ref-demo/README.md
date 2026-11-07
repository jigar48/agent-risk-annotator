# `--config-ref` before/after demo

A synthetic pull request that loosens its own risk configuration and changes payment code in
the same commit. It shows why CI should read `.riskannotate.json` from a trusted base commit
with `--config-ref` instead of from the pull request's working tree.

All code here is synthetic. Nothing is a real payment integration.

## The scenario

| Path                                                    | Base branch (`main`)                    | Pull request                                            |
| ------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------- |
| [`.riskannotate.json`](fixture/base/.riskannotate.json) | `"sensitivePaths": ["src/payments/**"]` | [`"sensitivePaths": []`](fixture/pr/.riskannotate.json) |
| `src/payments/charge.ts`                                | Capture call sends an idempotency key   | Idempotency key removed                                 |
| `src/catalog/sort.ts`                                   | Plain name sort                         | Locale-aware sort (ordinary change)                     |

The PR commit is titled `chore: tidy review config`.

## Before: the PR's own config is used

```text
$ risk-annotate --base main
```

[`expected/before.md`](expected/before.md):

```markdown
# Risk annotations

`main...HEAD` · 1 file · 1 HIGH · 0 MED · 0 LOW

## `.riskannotate.json`

- L3-3: [HIGH] Review-policy file `.riskannotate.json` changed; confirm sensitive-path coverage still matches intent (path heuristic)
```

The built-in review-policy signal still fires on the config edit, but the payment file isn't
mentioned: the pattern that protected it was removed in the same change.

## After: the trusted base config is used

```text
$ risk-annotate --base main --config-ref main --fail-on high
risk-annotate: found annotations at or above HIGH
```

Exit code `2`. [`expected/after.md`](expected/after.md):

```markdown
# Risk annotations

`main...HEAD` · 2 files · 2 HIGH · 0 MED · 0 LOW

## `.riskannotate.json`

- L3-3: [HIGH] Review-policy file `.riskannotate.json` changed; confirm sensitive-path coverage still matches intent (path heuristic)

## `src/payments/charge.ts`

- L7-7: [HIGH] Matches project sensitive path `src/payments/**`; review with extra care (path heuristic)
```

The diff is the same (`--base main`); only the source of the configuration changed. The
catalog change isn't flagged in either run.

## Reproduce it

From the root of this repository, after `npm ci && npm run build`:

```bash
demo="$(mktemp -d)"
cp -r examples/config-ref-demo/fixture/base/. "$demo"
git -C "$demo" init -q -b main
git -C "$demo" add -A
git -C "$demo" -c user.name=Demo -c user.email=demo@example.invalid commit -qm "chore: protect payments"
git -C "$demo" checkout -q -b agent/tidy-config
cp -r examples/config-ref-demo/fixture/pr/. "$demo"
git -C "$demo" -c user.name=Demo -c user.email=demo@example.invalid commit -qam "chore: tidy review config"
node dist/cli.js --cwd "$demo" --base main
node dist/cli.js --cwd "$demo" --base main --config-ref main --fail-on high
```

[`test/examples-config-ref.test.ts`](../../test/examples-config-ref.test.ts) builds the same
repository and checks both reports byte for byte.

## In real CI, `main` is not enough

This demo uses the local branch name `main` for readability. In a pull-request job, pass the
**base commit SHA your CI platform reports** (on GitHub Actions,
`github.event.pull_request.base.sha`), never a ref the pull request could have created or
moved. `--config-ref` reads whatever commit you name; it does not decide whether that commit
is trustworthy. See [In CI](../../README.md#in-ci).
