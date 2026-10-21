import type { FileAnnotation } from '../rules/engine.js';
import { VERSION } from '../version.js';
import { countLevels, type ReportMeta } from './common.js';

/**
 * Stable machine-readable report (schemaVersion 1). Additive changes only within a schema
 * version; anything breaking bumps it. No timestamps, so identical input → identical bytes.
 */
export function formatJson(files: readonly FileAnnotation[], meta: ReportMeta): string {
  const report = {
    schemaVersion: 1,
    tool: { name: 'risk-annotate', version: VERSION },
    range: meta.range,
    summary: { files: files.length, ...countLevels(files) },
    files: files.map((f) => ({
      path: f.path,
      oldPath: f.oldPath,
      status: f.status,
      level: f.level,
      hunks: f.hunks.map((h) => ({
        start: h.start,
        end: h.end,
        level: h.top.level,
        reason: h.top.reason,
        evidence: h.top.evidence,
        rule: h.top.ruleId,
        signals: h.signals.map((s) => ({
          rule: s.ruleId,
          level: s.level,
          reason: s.reason,
          evidence: s.evidence,
        })),
      })),
    })),
    warnings: meta.warnings,
  };
  return JSON.stringify(report, null, 2) + '\n';
}
