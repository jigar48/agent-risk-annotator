import type { Log, ReportingDescriptor, Result } from 'sarif';
import type { FileAnnotation } from '../rules/engine.js';
import { RULES } from '../rules/index.js';
import type { Level, RuleId } from '../rules/types.js';
import { VERSION } from '../version.js';
import type { ReportMeta } from './common.js';

const REPO_URL = 'https://github.com/jigar48/agent-risk-annotator';

const SARIF_LEVEL: Record<Level, Result.level> = { HIGH: 'error', MED: 'warning', LOW: 'note' };

const DESCRIPTIONS: Record<RuleId, { text: string; level: Level }> = {
  A: {
    text: 'File was touched by a fix/revert-style commit in the last 30 commits.',
    level: 'HIGH',
  },
  B: { text: 'Changed lines are inside a file or function with 0% test coverage.', level: 'MED' },
  C: { text: "Diff is over 3x the author's median commit size.", level: 'LOW' },
  D: { text: 'Adds a new direct dependency to a manifest.', level: 'MED' },
  E: {
    text: 'Touches a sensitive path (auth, crypto, secrets, keys, env, migrations).',
    level: 'HIGH',
  },
  F: { text: 'Removes lines from a test file.', level: 'HIGH' },
  G: { text: 'Changes CI or infrastructure configuration.', level: 'MED' },
  H: { text: 'Lockfile and manifest changed out of step.', level: 'MED' },
};

const ruleKey = (id: RuleId) => `RA-${id}`;

/**
 * SARIF 2.1.0 for GitHub code scanning. Every signal becomes a result (not just the top
 * one per hunk), mapped HIGH→error, MED→warning, LOW→note.
 */
export function formatSarif(files: readonly FileAnnotation[], meta: ReportMeta): string {
  const rules: ReportingDescriptor[] = RULES.map((r) => ({
    id: ruleKey(r.id),
    name: r.title.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) =>
      (c ?? '').toUpperCase(),
    ),
    shortDescription: { text: r.title },
    fullDescription: { text: DESCRIPTIONS[r.id].text },
    defaultConfiguration: { level: SARIF_LEVEL[DESCRIPTIONS[r.id].level] },
    helpUri: `${REPO_URL}#rules`,
  }));
  const index = new Map(RULES.map((r, i) => [r.id, i]));

  const results: Result[] = files.flatMap((f) =>
    f.hunks.flatMap((h) =>
      h.signals.map((s): Result => ({
        ruleId: ruleKey(s.ruleId),
        ruleIndex: index.get(s.ruleId) ?? 0,
        level: SARIF_LEVEL[s.level],
        message: { text: `${s.reason} (${s.evidence})` },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: encodeURI(f.path), uriBaseId: '%SRCROOT%' },
              region: { startLine: h.start, endLine: h.end },
            },
          },
        ],
        properties: { riskLevel: s.level, evidence: s.evidence },
      })),
    ),
  );

  const log: Log = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: { name: 'risk-annotate', version: VERSION, informationUri: REPO_URL, rules },
        },
        results,
        properties: { range: meta.range, warnings: meta.warnings },
      },
    ],
  };
  return JSON.stringify(log, null, 2) + '\n';
}
