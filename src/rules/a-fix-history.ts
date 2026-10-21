import type { Rule } from './types.js';

/** Applied to commit subjects, exactly as specified (substring match, so "debug" counts). */
export const FIX_PATTERN = /fix|hotfix|revert|incident|bug/i;

/**
 * Rule A — the file was touched by a fix/revert-style commit in the history window
 * (the 30 commits before the change). Renames are matched by their old path too.
 */
export const ruleA: Rule = {
  id: 'A',
  title: 'Fix-prone file',
  checkFile(file, ctx) {
    const paths = file.oldPath ? [file.path, file.oldPath] : [file.path];
    const fixes = ctx.history.filter(
      (c) => FIX_PATTERN.test(c.subject) && c.files.some((p) => paths.includes(p)),
    );
    const latest = fixes[0];
    if (!latest) return [];
    const short = latest.hash.slice(0, 7);
    const reason =
      fixes.length === 1
        ? `File was in fix/revert commit ${short} within the last ${ctx.history.length} commits; it has regressed before`
        : `File was in ${fixes.length} fix/revert commits within the last ${ctx.history.length} (latest ${short}); it has regressed before`;
    return [{ level: 'HIGH', reason, evidence: 'git log' }];
  },
};
