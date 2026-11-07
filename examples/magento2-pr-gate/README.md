# Magento 2 PR review gate

A copy-ready starter kit that makes [risk-annotate](../../README.md) flag the parts of a
Magento 2 pull request a reviewer should read first: checkout and totals, payment
integrations, shipping carriers, webhooks, module `etc/` wiring and `app/etc/` configuration.
It fails the check on any HIGH annotation.

It uses only features in the published **risk-annotate 0.3.0** (Rule E project sensitive
paths from `.riskannotate.json`). It needs no Magento installation, PHP, Composer, secrets or
write permissions.

> **Review priority, not vulnerabilities.** A HIGH annotation means "this path is one your
> team decided deserves extra care", not "this change is wrong or insecure". risk-annotate
> looks at file paths only; it does not read or understand the PHP or XML.

## What's here

| Path                                                       | Purpose                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| [`.riskannotate.json`](.riskannotate.json)                 | Sensitive-path patterns for a typical Magento 2 `app/code` project          |
| [`workflow/risk-annotate.yml`](workflow/risk-annotate.yml) | GitHub Actions workflow for pull requests                                   |
| [`fixture/base/`](fixture/base)                            | A synthetic Magento-style store (11 small files, no real data)              |
| [`fixture/pr/`](fixture/pr)                                | The same files after a synthetic "agent" PR: 6 risky edits, 4 ordinary ones |
| [`expected/report.md`](expected/report.md)                 | The exact report risk-annotate 0.3.0 produces for that PR                   |

## Setup

1. Copy [`.riskannotate.json`](.riskannotate.json) to the root of your Magento repository
   and adjust the patterns to your module names (see the table below).
2. Copy [`workflow/risk-annotate.yml`](workflow/risk-annotate.yml) to
   `.github/workflows/risk-annotate.yml`.
3. Commit both on your default branch **first**, in their own pull request. The workflow
   always uses the configuration from the PR's base branch, so a config that only exists in
   an open PR has no effect until it is merged.
4. Optional: list `.riskannotate.json` and `.github/workflows/` in `CODEOWNERS`, and make the
   **Risk annotations** check required in branch protection. Both are repository settings
   this kit does not change for you.

To try the patterns locally before committing, run `npx -y risk-annotate@0.3.0` in your
repository (it reads `.riskannotate.json` from the working tree).

## Patterns

All patterns are repository-relative and case-sensitive. They assume your own modules live
in `app/code/<Vendor>/<Module>/`; code under `vendor/` and theme overrides under
`app/design/` are deliberately not matched.

| Area                      | Patterns                                                                                                                                                                                                      | Why                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Checkout and totals       | `app/code/*/*Checkout*/**` `app/code/**/Total/**` `app/code/**/etc/sales.xml`                                                                                                                                 | Checkout modules, quote/order total collectors and their registration                                               |
| Payment integrations      | `app/code/*/*Payment*/**` `app/code/**/Gateway/**` `app/code/**/etc/payment.xml`                                                                                                                              | Payment modules, Payment Gateway command/request/response code, method registration                                 |
| Shipping and carriers     | `app/code/*/*Shipping*/**` `app/code/**/Carrier/**`                                                                                                                                                           | Shipping modules and carrier rate models                                                                            |
| Webhooks                  | `app/code/*/*Webhook*/**` `app/code/**/Webhook/**` `app/code/**/Webhooks/**`                                                                                                                                  | Inbound/outbound webhook controllers, signature checks, dispatchers                                                 |
| Module `etc/` wiring      | `app/code/**/etc/**/di.xml` `app/code/**/etc/**/events.xml` `app/code/**/etc/**/routes.xml` `app/code/**/etc/acl.xml` `app/code/**/etc/config.xml` `app/code/**/etc/crontab.xml` `app/code/**/etc/webapi.xml` | Plugins and preferences, observers, routes, ACL, default config, cron and REST/SOAP APIs (global and area-specific) |
| Critical `app/etc/` files | `app/etc/config.php` `app/etc/di.xml` `app/etc/env.php`                                                                                                                                                       | Enabled modules, global DI, deployment configuration                                                                |

- `app/etc/env.php` holds credentials and should never be committed. The pattern is a
  tripwire: if it ever appears in a PR, it is flagged HIGH.
- Not matched on purpose: `etc/module.xml`, `etc/adminhtml/system.xml`, `i18n/`, `view/`
  templates of non-checkout modules, `app/design/**` (including `Magento_Checkout` theme
  overrides) and `vendor/**`. Add patterns if your team wants them reviewed first.
- If a payment or shipping module is not named `*Payment*` / `*Shipping*`, add it explicitly,
  e.g. `app/code/Acme/Adyen/**`.
- Up to 100 patterns are allowed. A pattern that is invalid makes the run fail with exit
  code 1; it is never silently ignored.

## How the workflow works

- **Trigger and permissions.** `pull_request` (never `pull_request_target`) and
  `permissions: contents: read`. The job gets no repository secrets and a read-only token,
  and `persist-credentials: false` removes the token from `.git/config` after checkout.
- **Full history.** `fetch-depth: 0`, so risk-annotate can compute the merge base with the PR's
  base commit and read past commits for rules A and C.
- **Trusted configuration.** risk-annotate reads `.riskannotate.json` from the working tree,
  which the PR controls. Before it runs, a git-only step replaces that file with the copy from
  the PR's base commit (`github.event.pull_request.base.sha`):
  - Base has a config → that exact blob is written, whatever the PR did to the file.
  - Base has no config → the PR's copy is deleted and a notice says built-in rules only are
    used. A PR cannot introduce, loosen or replace patterns for its own run.
  - Base config is not a regular file (a symlink, directory or submodule) → the job fails.
  - Any unexpected git error (unknown commit, missing history) → the job fails, because the
    step runs under `set -euo pipefail`. It never falls back to the PR's copy.
- **Nothing from the PR is executed.** The only `run` step is git and file operations. No
  `npm install`, Composer, PHP or scripts from the repository run.
- **Pinned version.** The action is pinned to the full commit SHA of the published `v0.3.0` tag
  (`e284a043a1cd7031ebaa6fd4a130a25857294b49`), and `version: 0.3.0` makes it run exactly
  `risk-annotate@0.3.0` from npm. Update both together when you upgrade.
- **Gate.** `fail-on: high` fails the check when any HIGH annotation is found (exit code 2).
  The Markdown report is still written to the job summary first.

## Demo

From a clone of this repository, build the synthetic store as a two-commit git repository and
run the published version against it:

```bash
EX="$PWD/examples/magento2-pr-gate"
DEMO="$(mktemp -d)" && cd "$DEMO" && git init -q -b main
git config user.name demo && git config user.email demo@example.invalid
cp -R "$EX/fixture/base/." . && cp "$EX/.riskannotate.json" .
git add -A && git commit -q -m "Initial store"
cp -R "$EX/fixture/pr/." .
git add -A && git commit -q -m "Agent: checkout, payment, shipping and webhook changes"
npx -y risk-annotate@0.3.0 --fail-on high; echo "exit code: $?"
```

Output (stderr first, then the report on stdout):

```text
risk-annotate: found annotations at or above HIGH
# Risk annotations

`HEAD~1..HEAD` · 6 files · 6 HIGH · 0 MED · 0 LOW

## `app/code/Acme/CheckoutDiscount/Model/Total/Discount.php`

- L12-12: [HIGH] Matches project sensitive path `app/code/**/Total/**`; review with extra care (path heuristic)

## `app/code/Acme/ExamplePayment/Gateway/Request/CaptureRequestBuilder.php`

- L12-12: [HIGH] Matches project sensitive path `app/code/**/Gateway/**`; review with extra care (path heuristic)

## `app/code/Acme/FreightShipping/Model/Carrier/Freight.php`

- L8-8: [HIGH] Matches project sensitive path `app/code/**/Carrier/**`; review with extra care (path heuristic)

## `app/code/Acme/OrderSync/Controller/Webhook/Receive.php`

- L12-12: [HIGH] Matches project sensitive path `app/code/**/Webhook/**`; review with extra care (path heuristic)

## `app/code/Acme/OrderSync/etc/di.xml`

- L3-5: [HIGH] Matches project sensitive path `app/code/**/etc/**/di.xml`; review with extra care (path heuristic)

## `app/etc/config.php`

- L7-7: [HIGH] Matches project sensitive path `app/etc/config.php`; review with extra care (path heuristic)
exit code: 2
```

The synthetic PR removes the discount cap at the subtotal, drops a payment idempotency key,
cuts the free-shipping threshold tenfold, weakens a webhook signature check, adds a DI plugin
and enables a module. Those six files are flagged. The four ordinary edits (a catalog badge
label, a catalog `module.xml`, a `Magento_Checkout` theme stylesheet and the README) are in
the diff but not annotated. Without `.riskannotate.json`, the same PR reports
`No risk signals found.`

The output is deterministic: the same commits give byte-identical output on every run and
machine. `--format json` and `--format sarif` report the same six signals. The repository's
test suite ([`test/examples-magento2.test.ts`](../../test/examples-magento2.test.ts))
rebuilds this fixture, compares against [`expected/report.md`](expected/report.md), checks
every pattern against positive and negative paths, and runs the workflow's base-config step
against throwaway repositories.

## Version compatibility

| Feature used by this kit                                          | risk-annotate 0.3.0 (published) | `main` (unreleased) |
| ----------------------------------------------------------------- | ------------------------------- | ------------------- |
| `.riskannotate.json` with `sensitivePaths`                        | Yes                             | Yes                 |
| Action inputs `version`, `fail-on`; exit code 2 on threshold      | Yes                             | Yes                 |
| Flags a change to `.riskannotate.json` / `CODEOWNERS` itself HIGH | **No**                          | Yes                 |

The demo output above is identical with 0.3.0 and with the current `main` build. The last row
is unreleased: with 0.3.0, a PR that edits `.riskannotate.json` is not itself flagged. The
base-config step still prevents that PR from changing its own checks; once a release includes
review-policy detection, such a PR will also get a HIGH annotation on the config file.

## Limitations

- **Path-based only.** A risky change in a file outside the patterns (for example checkout
  logic in a plugin under a generically named module) is not flagged, and a harmless edit
  inside them is. Treat the patterns as a starting point and tune them to your modules.
- **Not a security scanner.** It does not analyze PHP, XML, GraphQL schemas, JavaScript or
  database patches, and it does not find vulnerabilities.
- **Not enforcement.** It does not change `CODEOWNERS`, branch protection or required reviews.
  To block merges, make the check required yourself.
- **Base-branch config by design.** Pattern changes take effect only after they are merged.
  A PR that tightens the config is judged by the old one.
- **`npx` downloads the tool.** The action runs `risk-annotate@0.3.0` from the npm registry;
  the package has no runtime dependencies. Mirror or vendor it if your runners have no
  internet access.
- **Rule E names one pattern per file**, the first in sorted order, even when several match.
