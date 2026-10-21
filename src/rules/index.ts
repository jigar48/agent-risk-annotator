import { ruleE } from './e-sensitive-paths.js';
import { ruleF } from './f-deleted-tests.js';
import { ruleG } from './g-ci-infra.js';
import { ruleH } from './h-lockfile-drift.js';
import type { Rule } from './types.js';

/** Registry in tie-break order. Rules A–D join in build step 5. */
export const RULES: readonly Rule[] = [ruleE, ruleF, ruleG, ruleH];
