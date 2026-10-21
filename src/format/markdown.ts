import type { FileAnnotation } from '../rules/engine.js';
import { NO_SIGNALS, countLevels, describeRange, type ReportMeta } from './common.js';

/**
 * One `##` section per file, one bullet per risky hunk:
 *   - L{start}-{end}: [{LEVEL}] {reason} ({evidence})
 */
export function formatMarkdown(files: readonly FileAnnotation[], meta: ReportMeta): string {
  if (files.length === 0) return `${NO_SIGNALS}\n`;

  const c = countLevels(files);
  const out = [
    '# Risk annotations',
    '',
    `\`${describeRange(meta.range)}\` · ${files.length} file${files.length === 1 ? '' : 's'} · ${c.HIGH} HIGH · ${c.MED} MED · ${c.LOW} LOW`,
  ];

  for (const f of files) {
    const renamed = f.oldPath ? ` (renamed from \`${f.oldPath}\`)` : '';
    const deleted = f.status === 'deleted' ? ' (deleted)' : '';
    out.push('', `## \`${f.path}\`${renamed}${deleted}`, '');
    for (const h of f.hunks) {
      out.push(`- L${h.start}-${h.end}: [${h.top.level}] ${h.top.reason} (${h.top.evidence})`);
    }
  }
  return out.join('\n') + '\n';
}
