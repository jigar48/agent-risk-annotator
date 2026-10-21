import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/context.js';
import { render, type Format } from '../../src/format/index.js';
import { annotate, type FileAnnotation } from '../../src/rules/engine.js';
import type { RepoContext } from '../../src/context.js';
import { createFixtureRepo } from '../helpers/fixture.js';
import type { TestRepo } from '../helpers/repo.js';

let repo: TestRepo;
let ctx: RepoContext;
let files: FileAnnotation[];

beforeAll(() => {
  repo = createFixtureRepo();
  ctx = buildContext({ cwd: repo.dir });
  files = annotate(ctx);
});
afterAll(() => repo.cleanup());

const out = (format: Format, f = files) => render(format, f, { range: ctx.range, warnings: [] });

describe('golden output (fixture trips every rule)', () => {
  it('fires each rule A–H as the top signal somewhere, except H (tied with D, D wins)', () => {
    const tops = new Set(files.flatMap((f) => f.hunks.map((h) => h.top.ruleId)));
    expect([...tops].sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
    const all = new Set(
      files.flatMap((f) => f.hunks.flatMap((h) => h.signals.map((s) => s.ruleId))),
    );
    expect([...all].sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  });

  it('markdown', async () => {
    await expect(out('markdown')).toMatchFileSnapshot('../golden/report.md');
  });

  it('json', async () => {
    await expect(out('json')).toMatchFileSnapshot('../golden/report.json');
  });

  it('sarif', async () => {
    await expect(out('sarif')).toMatchFileSnapshot('../golden/report.sarif.json');
  });

  it('every markdown bullet matches the specified line format', () => {
    const bullets = out('markdown')
      .split('\n')
      .filter((l) => l.startsWith('- '));
    expect(bullets.length).toBeGreaterThan(0);
    for (const b of bullets) {
      expect(b).toMatch(
        /^- L\d+-\d+: \[(HIGH|MED|LOW)\] [^\n]{1,120} \((git log|coverage report|commit size|dependency manifest|path heuristic)\)$/,
      );
    }
  });
});

describe('empty results', () => {
  it('markdown says so in one line', () => {
    expect(out('markdown', [])).toBe('No risk signals found.\n');
  });

  it('json and sarif stay well-formed', () => {
    expect(JSON.parse(out('json', []))).toMatchObject({
      summary: { files: 0, HIGH: 0, MED: 0, LOW: 0 },
      files: [],
    });
    expect(JSON.parse(out('sarif', [])).runs[0].results).toEqual([]);
  });
});
