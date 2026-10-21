import { matchAny } from '../util/glob.js';
import type { Rule } from './types.js';

export const TEST_PATTERNS = ['*.test.*', '*.spec.*', 'test_*.py', '*_test.go'];

/** Rule F — any hunk that removes lines from a test file. */
export const ruleF: Rule = {
  id: 'F',
  title: 'Deleted test lines',
  checkHunk(file, hunk) {
    const n = hunk.removed.length;
    if (n === 0 || !matchAny(file.path, TEST_PATTERNS)) return [];
    const lines = `${n} test line${n === 1 ? '' : 's'}`;
    const reason =
      file.status === 'deleted'
        ? `Deletes a test file (${lines}); confirm coverage was not dropped to make the suite pass`
        : hunk.added.length === 0
          ? `Removes ${lines}; confirm coverage was not dropped to make the suite pass`
          : `Rewrites ${lines}; check assertions were not weakened or skipped`;
    return [{ level: 'HIGH', reason, evidence: 'path heuristic' }];
  },
};
