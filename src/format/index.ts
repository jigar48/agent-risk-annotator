import type { FileAnnotation } from '../rules/engine.js';
import type { Format, ReportMeta } from './common.js';
import { formatJson } from './json.js';
import { formatMarkdown } from './markdown.js';
import { formatSarif } from './sarif.js';

export { FORMATS, type Format, type ReportMeta } from './common.js';

export function render(format: Format, files: readonly FileAnnotation[], meta: ReportMeta): string {
  switch (format) {
    case 'markdown':
      return formatMarkdown(files, meta);
    case 'json':
      return formatJson(files, meta);
    case 'sarif':
      return formatSarif(files, meta);
  }
}
