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

/** Rule E — sensitive paths. Checks old and new paths, so moving a file out of auth/ counts. */
export const ruleE: Rule = {
  id: 'E',
  title: 'Sensitive path',
  checkFile(file) {
    const paths = file.oldPath ? [file.path, file.oldPath] : [file.path];
    const hit = CATEGORIES.find((c) =>
      c.patterns.some((p) => paths.some((path) => matchGlob(path, p))),
    );
    return hit ? [{ level: 'HIGH', reason: hit.reason, evidence: 'path heuristic' }] : [];
  },
};
