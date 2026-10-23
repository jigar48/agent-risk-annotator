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

/**
 * Rule E — sensitive paths. Checks old and new paths, so moving a file out of auth/ counts.
 * Built-in categories win (their reasons are more specific); otherwise the first matching
 * `--sensitive-path` pattern, in the sorted order the context provides, is named.
 */
export const ruleE: Rule = {
  id: 'E',
  title: 'Sensitive path',
  checkFile(file, ctx) {
    const paths = file.oldPath ? [file.path, file.oldPath] : [file.path];
    const matches = (p: string) => paths.some((path) => matchGlob(path, p));

    const hit = CATEGORIES.find((c) => c.patterns.some(matches));
    if (hit) return [{ level: 'HIGH', reason: hit.reason, evidence: 'path heuristic' }];

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
