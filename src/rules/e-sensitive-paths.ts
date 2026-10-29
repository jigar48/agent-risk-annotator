import { CONFIG_FILE } from '../config.js';
import type { FileChange, FileStatus } from '../diff/parse.js';
import { matchGlob } from '../util/glob.js';
import type { Rule } from './types.js';

const CATEGORIES: { patterns: string[]; reason: string }[] = [
  {
    patterns: ['*.pem', '*.key'],
    reason: 'Key or certificate file changed; confirm no private key material is committed',
  },
  {
    patterns: ['.env*'],
    reason: 'Environment file changed; confirm no real secrets or credentials are committed',
  },
  {
    patterns: ['**/secrets/**'],
    reason: 'Touches a secrets directory; confirm no credentials are committed or exposed',
  },
  {
    patterns: ['**/auth/**'],
    reason: 'Touches auth code; check session, token and permission handling',
  },
  {
    patterns: ['**/crypto/**'],
    reason: 'Touches crypto code; check algorithms, key handling and randomness',
  },
  {
    patterns: ['**/migrations/**'],
    reason: 'Database migration changed; check for data loss and a safe rollback path',
  },
];

const OWNERS_ADVICE = 'confirm code-owner review requirements still match intent';

/**
 * Review-policy files: exact repo-relative paths (not globs, so `src/CODEOWNERS` is not one),
 * fixed here and independent of `sensitivePaths`. Only the path is checked, never contents.
 */
const POLICY_FILES: ReadonlyMap<string, string> = new Map([
  [CONFIG_FILE, 'confirm sensitive-path coverage still matches intent'],
  ['CODEOWNERS', OWNERS_ADVICE],
  ['.github/CODEOWNERS', OWNERS_ADVICE],
  ['docs/CODEOWNERS', OWNERS_ADVICE],
]);

const POLICY_VERB: Record<FileStatus, string> = {
  added: 'added',
  deleted: 'deleted',
  modified: 'changed',
  renamed: 'renamed',
  copied: 'copied',
};

/**
 * One reason for a changed policy file, or null. A deleted file's path is its old path; a
 * rename is also checked by its old path (moving the file away counts). A copy's source is
 * left untouched, so only its destination counts. Mode-only changes arrive as `modified`.
 */
function policyReason(file: FileChange): string | null {
  if (POLICY_FILES.has(file.path)) {
    return `Review-policy file \`${file.path}\` ${POLICY_VERB[file.status]}; ${POLICY_FILES.get(file.path)}`;
  }
  if (file.status === 'renamed' && file.oldPath !== null && POLICY_FILES.has(file.oldPath)) {
    return `Review-policy file \`${file.oldPath}\` renamed away; ${POLICY_FILES.get(file.oldPath)}`;
  }
  return null;
}

/**
 * Rule E — sensitive paths. Checks old and new paths, so moving a file out of auth/ counts.
 * Built-in categories win (their reasons are more specific), then review-policy files;
 * otherwise the first matching `--sensitive-path` pattern, in the sorted order the context
 * provides, is named. At most one signal per file.
 */
export const ruleE: Rule = {
  id: 'E',
  title: 'Sensitive path',
  checkFile(file, ctx) {
    const paths = file.oldPath ? [file.path, file.oldPath] : [file.path];
    const matches = (p: string) => paths.some((path) => matchGlob(path, p));

    const hit = CATEGORIES.find((c) => c.patterns.some(matches));
    if (hit) return [{ level: 'HIGH', reason: hit.reason, evidence: 'path heuristic' }];

    const policy = policyReason(file);
    if (policy) return [{ level: 'HIGH', reason: policy, evidence: 'path heuristic' }];

    const custom = ctx.sensitivePaths.find(matches);
    if (!custom) return [];
    // Backticks keep glob stars from rendering as Markdown emphasis.
    const shown = custom.length > 60 ? `${custom.slice(0, 59)}…` : custom;
    return [
      {
        level: 'HIGH',
        reason: `Matches project sensitive path \`${shown}\`; review with extra care`,
        evidence: 'path heuristic',
      },
    ];
  },
};
