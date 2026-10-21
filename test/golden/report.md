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
