import { matchGlob } from '../util/glob.js';
import type { Rule } from './types.js';

const CATEGORIES: { pattern: string; reason: string }[] = [
  {
    pattern: '.github/workflows/**',
    reason: 'CI workflow changed; check permissions, secret usage and triggers',
  },
  {
    pattern: 'Dockerfile*',
    reason: 'Container build changed; check base image, run-as user and exposed ports',
  },
  {
    pattern: 'docker-compose*',
    reason: 'Compose config changed; check exposed ports, volumes and environment',
  },
  {
    pattern: '**/terraform/**',
    reason: 'Terraform changed; check the plan for destroyed or publicly exposed resources',
  },
  {
    pattern: '**/k8s/**',
    reason: 'Kubernetes manifest changed; check RBAC, resource limits and exposure',
  },
];

/** Rule G — CI and infrastructure files. */
export const ruleG: Rule = {
  id: 'G',
  title: 'CI/infra change',
  checkFile(file) {
    const hit = CATEGORIES.find((c) => matchGlob(file.path, c.pattern));
    return hit ? [{ level: 'MED', reason: hit.reason, evidence: 'path heuristic' }] : [];
  },
};
