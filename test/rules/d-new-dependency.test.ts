import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/context.js';
import { ruleD } from '../../src/rules/d-new-dependency.js';
import { annotate } from '../../src/rules/engine.js';
import { MAX_REASON } from '../../src/rules/types.js';
import { createRepo, type TestRepo } from '../helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
  JSON.stringify({ name: 'x', dependencies: deps, devDependencies: dev }, null, 2) + '\n';

/** path → [[start, end, reason]] for HEAD~1..HEAD. */
const run = () =>
  Object.fromEntries(
    annotate(buildContext({ cwd: repo.dir }), [ruleD]).map((f) => [
      f.path,
      f.hunks.map((h) => [h.start, h.end, h.top.reason]),
    ]),
  );

describe('Rule D — new dependency', () => {
  it('reports a new npm dependency on the hunk that adds it', () => {
    repo = createRepo();
    repo.write('package.json', pkg({ react: '18.3.1' }, { vitest: '2.1.4' }));
    repo.commit('init');
    repo.write('package.json', pkg({ react: '18.3.1' }, { vitest: '2.1.4', zod: '3.23.8' }));
    repo.commit('add zod');

    const s = run();
    expect(s['package.json']).toHaveLength(1);
    const [start, end, reason] = s['package.json']?.[0] ?? [];
    expect(reason).toBe('Adds new dependency "zod"; review provenance, license and maintenance');
    // Hunk L7-8: the vitest line gains a trailing comma (7), the zod line is added (8).
    expect([start, end]).toEqual([7, 8]);
  });

  it('places each dependency on its own hunk and groups ones that share a hunk', () => {
    repo = createRepo();
    repo.write('package.json', pkg({ a: '1' }, { b: '1' }));
    repo.commit('init');
    repo.write('package.json', pkg({ a: '1', c: '1', d: '1', e: '1' }, { b: '1', f: '1' }));
    repo.commit('add several');

    const reasons = (run()['package.json'] ?? []).map((h) => h[2]);
    expect(reasons).toEqual([
      'Adds 3 new dependencies (c, d and 1 more); review provenance and license',
      'Adds new dependency "f"; review provenance, license and maintenance',
    ]);
  });

  it('ignores version bumps and removals', () => {
    repo = createRepo();
    repo.write('package.json', pkg({ a: '1.0.0', b: '1.0.0' }));
    repo.commit('init');
    repo.write('package.json', pkg({ a: '2.0.0' }));
    repo.commit('bump a, drop b');
    expect(run()).toEqual({});
  });

  it('handles requirements.txt with normalized names', () => {
    repo = createRepo();
    repo.write('requirements.txt', 'Django==4.2\n');
    repo.commit('init');
    repo.write('requirements.txt', 'Django==4.2\ntyping_extensions>=4\n');
    repo.commit('add te');
    expect(run()['requirements.txt']).toEqual([
      [2, 2, 'Adds new dependency "typing-extensions"; review provenance, license and maintenance'],
    ]);
  });

  it('treats every dependency of a brand-new manifest as new', () => {
    repo = createRepo();
    repo.write('README.md', 'x\n');
    repo.commit('init');
    repo.write(
      'go.mod',
      'module x\n\nrequire (\n\tgithub.com/a/b v1.0.0\n\tgithub.com/c/d v2.0.0\n)\n',
    );
    repo.commit('add go.mod');
    expect(run()['go.mod']?.[0]?.[2]).toBe(
      'Adds 2 new dependencies (github.com/a/b, github.com/c/d); review provenance and license',
    );
  });

  it('ignores non-manifest files and deleted manifests', () => {
    repo = createRepo();
    repo.write('package.json', pkg({ a: '1' }));
    repo.write('notes.json', '{"dependencies":{}}\n');
    repo.commit('init');
    repo.write('notes.json', '{"dependencies":{"x":"1"}}\n');
    repo.remove('package.json');
    repo.commit('change');
    expect(run()).toEqual({});
  });

  it(`keeps the worst-case reason within ${MAX_REASON} chars`, () => {
    repo = createRepo();
    repo.write('package.json', pkg({}));
    repo.commit('init');
    const many = Object.fromEntries(
      Array.from({ length: 99 }, (_, i) => [`@some-very-long-scope/package-name-${i}`, '1']),
    );
    repo.write('package.json', pkg(many));
    repo.commit('add 99');
    for (const [, , reason] of run()['package.json'] ?? []) {
      expect(String(reason).length).toBeLessThanOrEqual(MAX_REASON);
      expect(String(reason)).not.toMatch(/…$/); // fits without the engine's clamp
    }
  });
});
