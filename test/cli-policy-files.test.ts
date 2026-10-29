import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { Log } from 'sarif';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIG_FILE } from '../src/config.js';
import { EXIT_ERROR, EXIT_FAIL_ON, EXIT_OK, main } from '../src/main.js';
import { createRepo, lines, type TestRepo } from './helpers/repo.js';

function cli(args: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = main(args, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

interface JsonReport {
  files: {
    path: string;
    oldPath: string | null;
    status: string;
    hunks: {
      start: number;
      end: number;
      level: string;
      rule: string;
      reason: string;
      signals: { rule: string; level: string; reason: string }[];
    }[];
  }[];
}
const report = (repo: TestRepo, extra: string[] = []) =>
  JSON.parse(cli(['--format', 'json', ...extra], repo.dir).stdout) as JsonReport;

/** Rule E signals in a JSON report, as "path: reason". */
const ruleE = (r: JsonReport) =>
  r.files.flatMap((f) =>
    f.hunks.flatMap((h) =>
      h.signals.filter((s) => s.rule === 'E').map((s) => `${f.path}: ${s.reason}`),
    ),
  );

const OWNERS = 'confirm code-owner review requirements still match intent';
const CONFIG = 'confirm sensitive-path coverage still matches intent';
const owners = '* @org/maintainers\n/src/auth/ @org/security\n';
const config = JSON.stringify({ version: 1, sensitivePaths: ['src/payments/**'] }, null, 2) + '\n';

/** A synthetic repo with every policy file plus look-alikes, then one change on top. */
function scenario(change: (repo: TestRepo) => void): TestRepo {
  const repo = createRepo();
  repo.write('CODEOWNERS', owners);
  repo.write('.github/CODEOWNERS', owners);
  repo.write('docs/CODEOWNERS', owners);
  repo.write(CONFIG_FILE, config);
  repo.write('src/CODEOWNERS', owners);
  repo.write('docs/team/CODEOWNERS', owners);
  repo.write('packages/web/.riskannotate.json', config);
  repo.write('src/catalog/list.ts', lines(5));
  repo.commit('init');
  change(repo);
  repo.commit('change under review');
  return repo;
}

const repos: TestRepo[] = [];
const make = (change: (repo: TestRepo) => void) => {
  const repo = scenario(change);
  repos.push(repo);
  return repo;
};
afterAll(() => repos.forEach((r) => r.cleanup()));

describe('review-policy files end to end', () => {
  it.each([
    ['CODEOWNERS', OWNERS],
    ['.github/CODEOWNERS', OWNERS],
    ['docs/CODEOWNERS', OWNERS],
  ])('flags a modified %s HIGH under Rule E', (path, advice) => {
    const repo = make((r) => r.write(path, `${owners}/docs/ @org/docs\n`));
    expect(ruleE(report(repo))).toEqual([
      `${path}: Review-policy file \`${path}\` changed; ${advice}`,
    ]);
  });

  it('flags a modified .riskannotate.json, and still applies the new config', () => {
    const repo = make((r) => {
      r.write(CONFIG_FILE, JSON.stringify({ version: 1, sensitivePaths: ['src/catalog/**'] }));
      r.write('src/catalog/list.ts', lines(5).replace('line 2\n', 'line 2 x\n'));
    });
    expect(ruleE(report(repo))).toEqual([
      `.riskannotate.json: Review-policy file \`.riskannotate.json\` changed; ${CONFIG}`,
      'src/catalog/list.ts: Matches project sensitive path `src/catalog/**`; review with extra care',
    ]);
  });

  it('flags an added policy file', () => {
    const repo = createRepo();
    repos.push(repo);
    repo.write('src/a.ts', lines(3));
    repo.commit('init');
    repo.write('.github/CODEOWNERS', owners);
    repo.commit('add owners');
    const r = report(repo);
    expect(r.files[0]).toMatchObject({ path: '.github/CODEOWNERS', status: 'added' });
    expect(ruleE(r)).toEqual([
      `.github/CODEOWNERS: Review-policy file \`.github/CODEOWNERS\` added; ${OWNERS}`,
    ]);
  });

  it('flags deletions of every policy file, at L1-1', () => {
    const repo = make((r) => {
      for (const p of ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS', CONFIG_FILE]) {
        r.remove(p);
      }
    });
    const r = report(repo);
    expect(ruleE(r)).toEqual([
      `.github/CODEOWNERS: Review-policy file \`.github/CODEOWNERS\` deleted; ${OWNERS}`,
      `.riskannotate.json: Review-policy file \`.riskannotate.json\` deleted; ${CONFIG}`,
      `CODEOWNERS: Review-policy file \`CODEOWNERS\` deleted; ${OWNERS}`,
      `docs/CODEOWNERS: Review-policy file \`docs/CODEOWNERS\` deleted; ${OWNERS}`,
    ]);
    for (const f of r.files)
      expect(f).toMatchObject({ status: 'deleted', hunks: [{ start: 1, end: 1 }] });
  });

  it('flags a rename away from a protected location', () => {
    const repo = make((r) => {
      r.remove('.github/CODEOWNERS');
      r.write('.github/CODEOWNERS.disabled', owners);
    });
    const r = report(repo);
    expect(r.files).toEqual([
      expect.objectContaining({
        path: '.github/CODEOWNERS.disabled',
        oldPath: '.github/CODEOWNERS',
        status: 'renamed',
      }),
    ]);
    expect(ruleE(r)).toEqual([
      `.github/CODEOWNERS.disabled: Review-policy file \`.github/CODEOWNERS\` renamed away; ${OWNERS}`,
    ]);
  });

  it('flags a rename into a protected location', () => {
    const repo = createRepo();
    repos.push(repo);
    repo.write('team/OWNERS.txt', owners);
    repo.commit('init');
    repo.remove('team/OWNERS.txt');
    repo.write('docs/CODEOWNERS', owners);
    repo.commit('move owners');
    const r = report(repo);
    expect(r.files[0]).toMatchObject({ path: 'docs/CODEOWNERS', status: 'renamed' });
    expect(ruleE(r)).toEqual([
      `docs/CODEOWNERS: Review-policy file \`docs/CODEOWNERS\` renamed; ${OWNERS}`,
    ]);
  });

  it('flags a copy onto a protected path (reported by git as an addition); the source is untouched', () => {
    const repo = createRepo();
    repos.push(repo);
    repo.write('CODEOWNERS', owners);
    repo.commit('init');
    repo.write('docs/CODEOWNERS', owners);
    repo.commit('copy owners');
    expect(ruleE(report(repo))).toEqual([
      `docs/CODEOWNERS: Review-policy file \`docs/CODEOWNERS\` added; ${OWNERS}`,
    ]);
  });

  it('flags a mode-only change', () => {
    const repo = make((r) => {
      chmodSync(join(r.dir, 'CODEOWNERS'), 0o755); // no-op where the filesystem has no modes
      r.git('update-index', '--chmod=+x', 'CODEOWNERS');
    });
    expect(repo.git('show', '--format=', '--summary', 'HEAD')).toContain('mode change');
    const r = report(repo);
    expect(r.files).toEqual([
      expect.objectContaining({
        path: 'CODEOWNERS',
        status: 'modified',
        hunks: [expect.objectContaining({ start: 1, end: 1 })],
      }),
    ]);
    expect(ruleE(r)).toEqual([`CODEOWNERS: Review-policy file \`CODEOWNERS\` changed; ${OWNERS}`]);
  });

  it('ignores nested and look-alike files, and unchanged policy files', () => {
    const repo = make((r) => {
      r.write('src/CODEOWNERS', `${owners}# nested\n`);
      r.write('docs/team/CODEOWNERS', `${owners}# nested\n`);
      r.write('packages/web/.riskannotate.json', JSON.stringify({ version: 1 }));
      r.write('CODEOWNERS.md', '# about owners\n');
      r.write('src/catalog/list.ts', lines(5).replace('line 1\n', 'line 1 x\n'));
    });
    const r = cli(['--format', 'json'], repo.dir);
    expect(r).toMatchObject({ code: EXIT_OK, stderr: '' });
    expect(ruleE(JSON.parse(r.stdout) as JsonReport)).toEqual([]);
    expect(cli([], repo.dir).stdout).toBe('No risk signals found.\n');
  });

  it('keeps existing sensitive-path signals alongside policy signals', () => {
    const repo = make((r) => {
      r.write('CODEOWNERS', `${owners}# tweak\n`);
      r.write('src/auth/session.ts', lines(3));
      r.write('src/payments/charge.ts', lines(3));
    });
    expect(ruleE(report(repo))).toEqual([
      `CODEOWNERS: Review-policy file \`CODEOWNERS\` changed; ${OWNERS}`,
      'src/auth/session.ts: Touches auth code; check session, token and permission handling',
      'src/payments/charge.ts: Matches project sensitive path `src/payments/**`; review with extra care',
    ]);
  });
});

describe('formats, exit codes and determinism', () => {
  let repo: TestRepo;
  beforeAll(() => {
    repo = make((r) => {
      r.write('.github/CODEOWNERS', `${owners}/docs/ @org/docs\n`);
      r.remove('docs/CODEOWNERS');
    });
  });

  it('Markdown, JSON and SARIF report the same signals', () => {
    const md = cli([], repo.dir).stdout;
    expect(md).toContain('## `.github/CODEOWNERS`');
    expect(md).toContain(
      `- L3-3: [HIGH] Review-policy file \`.github/CODEOWNERS\` changed; ${OWNERS} (path heuristic)`,
    );
    expect(md).toContain(
      `- L1-1: [HIGH] Review-policy file \`docs/CODEOWNERS\` deleted; ${OWNERS} (path heuristic)`,
    );

    const json = report(repo);
    expect(json.files.map((f) => [f.path, f.hunks.map((h) => [h.level, h.rule])])).toEqual([
      ['.github/CODEOWNERS', [['HIGH', 'E']]],
      ['docs/CODEOWNERS', [['HIGH', 'E']]],
    ]);

    const log = JSON.parse(cli(['--format', 'sarif'], repo.dir).stdout) as Log;
    const results = log.runs[0]?.results ?? [];
    expect(
      results.map((r) => [
        r.ruleId,
        r.level,
        r.locations?.[0]?.physicalLocation?.artifactLocation?.uri,
        r.message.text,
      ]),
    ).toEqual(
      json.files.map((f) => ['RA-E', 'error', f.path, `${f.hunks[0]?.reason} (path heuristic)`]),
    );
  });

  it('--fail-on high returns exit code 2 for a policy file alone', () => {
    const r = cli(['--fail-on', 'high'], repo.dir);
    expect(r.code).toBe(EXIT_FAIL_ON);
    expect(r.stdout).toContain('[HIGH] Review-policy file');
  });

  it('is deterministic and never duplicates a signal', () => {
    for (const format of ['markdown', 'json', 'sarif']) {
      const runs = [1, 2, 3].map(() => cli(['--format', format], repo.dir).stdout);
      expect(new Set(runs).size).toBe(1);
    }
    const e = ruleE(report(repo));
    expect(new Set(e).size).toBe(e.length);
    expect(e).toHaveLength(2);
  });

  it('custom sensitive paths matching policy files do not add a second signal', () => {
    const e = ruleE(report(repo, ['--sensitive-path', '**', '--sensitive-path', '**/CODEOWNERS']));
    expect(e).toEqual(ruleE(report(repo)));
  });
});

describe('invalid configuration is unchanged', () => {
  it('a committed invalid .riskannotate.json still fails closed: exit 1, no report', () => {
    const repo = make((r) => r.write(CONFIG_FILE, '{ "version": 2 }'));
    for (const format of ['markdown', 'json', 'sarif']) {
      const r = cli(['--format', format, '--fail-on', 'high'], repo.dir);
      expect(r.code).toBe(EXIT_ERROR);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^risk-annotate: .*unsupported version 2/);
    }
  });
});
