import { afterEach, describe, expect, it } from 'vitest';
import { buildContext } from '../../src/context.js';
import { annotate } from '../../src/rules/engine.js';
import { ruleH } from '../../src/rules/h-lockfile-drift.js';
import { MAX_REASON } from '../../src/rules/types.js';
import { createRepo, type TestRepo } from '../helpers/repo.js';

let repo: TestRepo;
afterEach(() => repo?.cleanup());

const pkg = (deps: Record<string, string>, extra: object = {}) =>
  JSON.stringify({ name: 'x', dependencies: deps, ...extra }, null, 2) + '\n';

/** Rule H signals keyed by path, for the HEAD~1..HEAD change. */
function signals() {
  return Object.fromEntries(
    annotate(buildContext({ cwd: repo.dir }), [ruleH]).map((f) => [
      f.path,
      f.hunks.map((h) => h.top.reason),
    ]),
  );
}

function npmRepo() {
  repo = createRepo();
  repo.write('package.json', pkg({ a: '1.0.0' }));
  repo.write('package-lock.json', '{"lockfileVersion":3,"a":"1.0.0"}\n');
  repo.write('src/index.ts', 'x\n');
  repo.commit('init');
}

describe('Rule H — lockfile drift', () => {
  it('flags a lockfile that changed without its manifest', () => {
    npmRepo();
    repo.write('package-lock.json', '{"lockfileVersion":3,"a":"1.0.1"}\n');
    repo.commit('bump lock');
    const s = signals();
    expect(Object.keys(s)).toEqual(['package-lock.json']);
    expect(s['package-lock.json']?.[0]).toMatch(
      /^package-lock\.json changed without any package\.json change/,
    );
  });

  it('flags manifest dependency changes without a lockfile update', () => {
    npmRepo();
    repo.write('package.json', pkg({ a: '1.0.0', b: '2.0.0' }));
    repo.commit('add b');
    expect(signals()['package.json']?.[0]).toBe(
      'package.json dependencies changed but package-lock.json was not updated; installs may drift',
    );
  });

  it('stays silent when both changed together', () => {
    npmRepo();
    repo.write('package.json', pkg({ a: '1.0.0', b: '2.0.0' }));
    repo.write('package-lock.json', '{"lockfileVersion":3,"a":"1.0.0","b":"2.0.0"}\n');
    repo.commit('add b properly');
    expect(signals()).toEqual({});
  });

  it('ignores manifest edits that do not touch dependencies', () => {
    npmRepo();
    repo.write('package.json', pkg({ a: '1.0.0' }, { scripts: { test: 'vitest' } }));
    repo.commit('add script');
    expect(signals()).toEqual({});
  });

  it('ignores manifests in projects without a lockfile', () => {
    repo = createRepo();
    repo.write('requirements.txt', 'django==4.2\n');
    repo.write('pyproject.toml', '[project]\ndependencies = ["httpx"]\n');
    repo.commit('init');
    repo.write('pyproject.toml', '[project]\ndependencies = ["httpx", "rich"]\n');
    repo.commit('add rich');
    expect(signals()).toEqual({});
  });

  it('understands workspaces: one root lockfile, nested manifests', () => {
    repo = createRepo();
    repo.write('package.json', pkg({}, { workspaces: ['packages/*'] }));
    repo.write('pnpm-lock.yaml', 'lockfileVersion: 9\n');
    repo.write('packages/web/package.json', pkg({ react: '18.3.1' }));
    repo.commit('init');

    // Nested manifest dependency change, root lockfile untouched → flagged.
    repo.write('packages/web/package.json', pkg({ react: '18.3.1', zod: '3.23.8' }));
    repo.commit('add zod');
    expect(signals()['packages/web/package.json']?.[0]).toMatch(/pnpm-lock\.yaml was not updated/);

    // Root lockfile change explained by a nested manifest change → silent.
    repo.write('packages/web/package.json', pkg({ react: '18.3.1', zod: '3.23.9' }));
    repo.write('pnpm-lock.yaml', 'lockfileVersion: 9\n# zod 3.23.9\n');
    repo.commit('bump zod');
    expect(signals()).toEqual({});
  });

  it('covers go.sum ↔ go.mod and Cargo.lock ↔ Cargo.toml', () => {
    repo = createRepo();
    repo.write('go.mod', 'module x\n\nrequire github.com/a/b v1.0.0\n');
    repo.write('go.sum', 'github.com/a/b v1.0.0 h1:x\n');
    repo.write('Cargo.toml', '[dependencies]\nserde = "1"\n');
    repo.write('Cargo.lock', 'version = 3\n');
    repo.commit('init');
    repo.write('go.sum', 'github.com/a/b v1.0.0 h1:y\n');
    repo.write('Cargo.toml', '[dependencies]\nserde = "1"\nanyhow = "1"\n');
    repo.commit('drift both ways');
    const s = signals();
    expect(s['go.sum']?.[0]).toMatch(/^go\.sum changed without any go\.mod change/);
    expect(s['Cargo.toml']?.[0]).toMatch(/^Cargo\.toml dependencies changed but Cargo\.lock/);
  });

  it('stays silent on an unparseable manifest', () => {
    npmRepo();
    repo.write('package.json', '{ "dependencies": { oops');
    repo.commit('broken');
    expect(signals()).toEqual({});
  });

  it(`keeps every reason within ${MAX_REASON} chars`, () => {
    npmRepo();
    repo.write('npm-shrinkwrap.json', '{}\n');
    repo.commit('shrinkwrap');
    for (const reasons of Object.values(signals())) {
      for (const r of reasons) expect(r.length).toBeLessThanOrEqual(MAX_REASON);
    }
  });
});
