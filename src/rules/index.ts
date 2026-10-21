import { ruleA } from './a-fix-history.js';
import { ruleB } from './b-coverage.js';
import { ruleC } from './c-commit-size.js';
import { ruleD } from './d-new-dependency.js';
import { ruleE } from './e-sensitive-paths.js';
import { ruleF } from './f-deleted-tests.js';
import { ruleG } from './g-ci-infra.js';
import { ruleH } from './h-lockfile-drift.js';
import type { Rule } from './types.js';

/** Registry in tie-break order: when two signals share a level, the earlier rule wins. */
export const RULES: readonly Rule[] = [ruleA, ruleB, ruleC, ruleD, ruleE, ruleF, ruleG, ruleH];
