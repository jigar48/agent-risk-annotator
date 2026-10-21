import type { Log } from 'sarif';
import { describe, expect, it } from 'vitest';
import { formatSarif } from '../../src/format/sarif.js';
import type { FileAnnotation } from '../../src/rules/engine.js';
import { EMPTY_TREE } from '../../src/git.js';

const files: FileAnnotation[] = [
  {
    path: 'src/my file.ts',
    oldPath: null,
    status: 'modified',
    level: 'HIGH',
    hunks: [
      {
        start: 3,
        end: 7,
        top: { ruleId: 'E', level: 'HIGH', reason: 'auth', evidence: 'path heuristic' },
        signals: [
          { ruleId: 'E', level: 'HIGH', reason: 'auth', evidence: 'path heuristic' },
          { ruleId: 'C', level: 'LOW', reason: 'big', evidence: 'commit size' },
        ],
      },
    ],
  },
];

const log = (): Log =>
  JSON.parse(
    formatSarif(files, {
      range: { base: EMPTY_TREE, head: 'HEAD', threeDot: false },
      warnings: [],
    }),
  ) as Log;

describe('formatSarif', () => {
  it('declares SARIF 2.1.0 with one rule per A–H', () => {
    const l = log();
    expect(l.version).toBe('2.1.0');
    expect(l.$schema).toMatch(/sarif-2\.1\.0/);
    const rules = l.runs[0]?.tool.driver.rules ?? [];
    expect(rules.map((r) => r.id)).toEqual([
      'RA-A',
      'RA-B',
      'RA-C',
      'RA-D',
      'RA-E',
      'RA-F',
      'RA-G',
      'RA-H',
    ]);
    expect(rules[0]?.name).toBe('FixProneFile');
    expect(rules.find((r) => r.id === 'RA-C')?.defaultConfiguration?.level).toBe('note');
  });

  it('emits one result per signal with mapped level, region and a valid ruleIndex', () => {
    const run = log().runs[0];
    const results = run?.results ?? [];
    expect(results.map((r) => [r.ruleId, r.level])).toEqual([
      ['RA-E', 'error'],
      ['RA-C', 'note'],
    ]);
    for (const r of results) {
      expect(run?.tool.driver.rules?.[r.ruleIndex ?? -1]?.id).toBe(r.ruleId);
      expect(r.locations?.[0]?.physicalLocation?.region).toEqual({ startLine: 3, endLine: 7 });
    }
    expect(results[0]?.message.text).toBe('auth (path heuristic)');
  });

  it('URI-encodes artifact paths relative to %SRCROOT%', () => {
    const loc = log().runs[0]?.results?.[0]?.locations?.[0]?.physicalLocation?.artifactLocation;
    expect(loc).toEqual({ uri: 'src/my%20file.ts', uriBaseId: '%SRCROOT%' });
  });
});
