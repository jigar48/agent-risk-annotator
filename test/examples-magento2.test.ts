import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CONFIG_FILE, parseConfig } from '../src/config.js';
import { EXIT_ERROR, EXIT_FAIL_ON, EXIT_OK, main } from '../src/main.js';
import { normalizePattern } from '../src/sensitive-paths.js';
import { matchAny } from '../src/util/glob.js';
import { createRepo, type TestRepo } from './helpers/repo.js';

/**
 * examples/magento2-pr-gate: the copy-ready config, workflow and synthetic fixture must keep
 * producing the documented report. Everything here uses only existing Rule E behavior.
 */
const EXAMPLE = join(import.meta.dirname, '..', 'examples', 'magento2-pr-gate');
const read = (...p: string[]) => readFileSync(join(EXAMPLE, ...p), 'utf8').replace(/\r\n/g, '\n');
const configText = read(CONFIG_FILE);
const patterns = parseConfig(new TextEncoder().encode(configText)).sensitivePaths;
const workflow = read('workflow', 'risk-annotate.yml');

function cli(args: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = main(args, { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t), cwd });
  return { code, stdout, stderr };
}

/** Repo-relative POSIX paths of every file under `dir`. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((p) => statSync(join(dir, p)).isFile())
    .map((p) => p.split(sep).join('/'))
    .sort();
}

function copyTree(repo: TestRepo, from: string) {
  for (const p of listFiles(from)) {
    repo.write(p, readFileSync(join(from, p), 'utf8').replace(/\r\n/g, '\n'));
  }
}

const repos: TestRepo[] = [];
afterAll(() => repos.forEach((r) => r.cleanup()));

/** The fixture as two commits: base store + config, then the PR overlay. */
function fixtureRepo(): TestRepo {
  const repo = createRepo();
  repos.push(repo);
  copyTree(repo, join(EXAMPLE, 'fixture', 'base'));
  repo.write(CONFIG_FILE, configText);
  repo.commit('Initial store');
  copyTree(repo, join(EXAMPLE, 'fixture', 'pr'));
  repo.commit('Agent: checkout, payment, shipping and webhook changes');
  return repo;
}

describe('magento2-pr-gate .riskannotate.json', () => {
  it('is a valid version 1 config whose patterns are already in normalized form', () => {
    const raw = (JSON.parse(configText) as { sensitivePaths: string[] }).sensitivePaths;
    expect(raw.map((p) => normalizePattern(p))).toEqual(raw);
    expect(new Set(raw).size).toBe(raw.length);
    expect(patterns).toHaveLength(raw.length);
    expect(patterns.length).toBeLessThanOrEqual(100);
  });

  it.each([
    // Checkout and totals
    'app/code/Acme/CheckoutDiscount/Model/Total/Discount.php',
    'app/code/Acme/OneStepCheckout/view/frontend/web/js/view/payment.js',
    'app/code/Acme/Sales/Model/Quote/Address/Total/Fee.php',
    'app/code/Acme/Fee/etc/sales.xml',
    // Payment
    'app/code/Acme/ExamplePayment/Model/Method.php',
    'app/code/Acme/Pay/Gateway/Request/CaptureRequestBuilder.php',
    'app/code/Acme/Pay/etc/payment.xml',
    // Shipping and carriers
    'app/code/Acme/FreightShipping/Model/Rate.php',
    'app/code/Acme/Logistics/Model/Carrier/Freight.php',
    // Webhooks
    'app/code/Acme/OrderWebhook/Model/Dispatcher.php',
    'app/code/Acme/OrderSync/Controller/Webhook/Receive.php',
    'app/code/Acme/OrderSync/Model/Webhooks/Signature.php',
    // Module etc configuration, including area-specific files
    'app/code/Acme/OrderSync/etc/di.xml',
    'app/code/Acme/OrderSync/etc/frontend/di.xml',
    'app/code/Acme/OrderSync/etc/adminhtml/events.xml',
    'app/code/Acme/OrderSync/etc/frontend/routes.xml',
    'app/code/Acme/OrderSync/etc/acl.xml',
    'app/code/Acme/OrderSync/etc/config.xml',
    'app/code/Acme/OrderSync/etc/crontab.xml',
    'app/code/Acme/OrderSync/etc/webapi.xml',
    // Critical app/etc configuration
    'app/etc/config.php',
    'app/etc/di.xml',
    'app/etc/env.php',
  ])('flags %s', (path) => {
    expect(matchAny(path, patterns)).toBeDefined();
  });

  it.each([
    'app/code/Acme/Catalog/Block/ProductBadge.php',
    'app/code/Acme/Catalog/etc/module.xml',
    'app/code/Acme/Catalog/etc/adminhtml/system.xml',
    'app/code/Acme/Catalog/i18n/en_US.csv',
    // Look-alikes outside app/code: theme overrides and vendor code are not matched.
    'app/design/frontend/Acme/storefront/Magento_Checkout/web/css/source/_module.less',
    'vendor/magento/module-checkout/Model/Session.php',
    'app/etc/NonComposerComponentRegistration.php',
    // Case-sensitive, like git paths.
    'app/code/Acme/OrderSync/etc/DI.xml',
    'README.md',
  ])('does not flag %s', (path) => {
    expect(matchAny(path, patterns)).toBeUndefined();
  });
});

describe('magento2-pr-gate fixture', () => {
  const repo = fixtureRepo();

  it('produces the documented Markdown report and exit code 2 with --fail-on high', () => {
    const run = cli(['--fail-on', 'high'], repo.dir);
    expect(run.code).toBe(EXIT_FAIL_ON);
    expect(run.stdout).toBe(read('expected', 'report.md'));
    expect(run.stderr).toBe('risk-annotate: found annotations at or above HIGH\n');
  });

  it('reports exit code 0 without a threshold', () => {
    expect(cli([], repo.dir).code).toBe(EXIT_OK);
  });

  it('flags only the risky files in JSON, all HIGH under Rule E', () => {
    const json = JSON.parse(cli(['--format', 'json'], repo.dir).stdout) as {
      files: { path: string; hunks: { level: string; rule: string }[] }[];
    };
    expect(json.files.map((f) => f.path)).toEqual([
      'app/code/Acme/CheckoutDiscount/Model/Total/Discount.php',
      'app/code/Acme/ExamplePayment/Gateway/Request/CaptureRequestBuilder.php',
      'app/code/Acme/FreightShipping/Model/Carrier/Freight.php',
      'app/code/Acme/OrderSync/Controller/Webhook/Receive.php',
      'app/code/Acme/OrderSync/etc/di.xml',
      'app/etc/config.php',
    ]);
    for (const f of json.files) {
      expect(f.hunks.map((h) => `${h.rule}:${h.level}`)).toEqual(['E:HIGH']);
    }
    // The ordinary changes really are in the diff; they are just not annotated.
    const changed = repo.git('diff', '--name-only', 'HEAD~1', 'HEAD').trim().split('\n');
    expect(changed).toHaveLength(10);
  });

  it('is deterministic across runs and formats', () => {
    for (const format of ['markdown', 'json', 'sarif']) {
      const a = cli(['--format', format], repo.dir).stdout;
      expect(cli(['--format', format], repo.dir).stdout).toBe(a);
    }
  });

  it('finds nothing without the config, so the findings come from the example patterns', () => {
    const bare = createRepo();
    repos.push(bare);
    copyTree(bare, join(EXAMPLE, 'fixture', 'base'));
    bare.commit('Initial store');
    copyTree(bare, join(EXAMPLE, 'fixture', 'pr'));
    bare.commit('change');
    expect(cli(['--fail-on', 'high'], bare.dir)).toMatchObject({
      code: EXIT_OK,
      stdout: 'No risk signals found.\n',
    });
  });
});

describe('magento2-pr-gate workflow', () => {
  it('runs on pull_request with a read-only token and no secrets', () => {
    expect(workflow).toMatch(/^on:\n(?: {2}#.*\n)* {2}pull_request:\n/m);
    const code = workflow.replace(/^\s*#.*$/gm, '');
    expect(code).not.toMatch(/pull_request_target|workflow_run/);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n\n/m);
    expect(workflow.match(/^\s*permissions:/gm)).toHaveLength(1);
    expect(code).not.toMatch(/\bsecrets\b|GITHUB_TOKEN|github\.token|\bwrite\b/);
    expect(workflow).toMatch(/persist-credentials: false/);
  });

  it('checks out full history and fails on HIGH', () => {
    expect(workflow).toMatch(/fetch-depth: 0\n/);
    expect(workflow).toMatch(/^ {10}fail-on: high$/m);
  });

  it('pins the action to a full commit SHA and the matching npm version', () => {
    const uses = workflow.match(/uses: jigar48\/agent-risk-annotator@(\S+) # (v\S+)/);
    expect(uses?.[1]).toMatch(/^[0-9a-f]{40}$/);
    expect(uses?.[2]).toBe('v0.3.0');
    expect(workflow).toMatch(/^ {10}version: 0\.3\.0$/m);
  });

  it('runs no code from the pull request: one git-only run step and no local actions', () => {
    expect(workflow.match(/^\s+run: /gm)).toHaveLength(1);
    expect(workflow).not.toMatch(/uses: \.\//);
    expect(script).not.toMatch(/\b(npm|npx|yarn|pnpm|composer|php|make|bash|sh|eval|source)\b/);
  });
});

/**
 * The base-config step itself, extracted from the workflow and run with bash against
 * throwaway repos. Skipped where `bash` may not be Git's (Windows outside Git Bash).
 */
const script = (() => {
  const m = workflow.match(/# base-config:start\n([\s\S]*?)\n\s*# base-config:end/);
  return (m?.[1] ?? '').replace(/^ {10}/gm, '');
})();
const bashUsable =
  (process.platform !== 'win32' || !!process.env.MSYSTEM) &&
  spawnSync('bash', ['-c', 'printf ok'], { encoding: 'utf8' }).stdout === 'ok';

function runStep(repo: TestRepo, baseSha: string) {
  const r = spawnSync('bash', ['-c', script], {
    cwd: repo.dir,
    encoding: 'utf8',
    env: { ...process.env, BASE_SHA: baseSha },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

const loosened = JSON.stringify({ version: 1, sensitivePaths: ['docs/**'] }) + '\n';

describe.skipIf(!bashUsable)('magento2-pr-gate base-branch config step', () => {
  it('was found in the workflow', () => {
    expect(script).toMatch(/^set -euo pipefail\n/);
  });

  it('restores the base config when a PR loosens it, so payment changes stay HIGH', () => {
    const repo = createRepo();
    repos.push(repo);
    copyTree(repo, join(EXAMPLE, 'fixture', 'base'));
    repo.write(CONFIG_FILE, configText);
    const base = repo.commit('Initial store');
    copyTree(repo, join(EXAMPLE, 'fixture', 'pr'));
    repo.write(CONFIG_FILE, loosened);
    repo.commit('PR that also loosens the config');

    const payment = 'app/code/Acme/ExamplePayment/Gateway/Request/';
    const json = () => cli(['--base', base, '--format', 'json'], repo.dir).stdout;
    // With the PR's own config, the payment change is no longer annotated.
    expect(json()).not.toContain(payment);

    const step = runStep(repo, base);
    expect(step).toMatchObject({ code: 0 });
    expect(step.out).toContain(`Using .riskannotate.json from base commit ${base}.`);
    expect(readFileSync(join(repo.dir, CONFIG_FILE), 'utf8')).toBe(configText);
    expect(json()).toContain(payment);
    expect(cli(['--base', base, '--fail-on', 'high'], repo.dir).code).toBe(EXIT_FAIL_ON);
  });

  it('removes a config the PR adds when the base branch has none', () => {
    const repo = createRepo();
    repos.push(repo);
    repo.write('README.md', 'store\n');
    const base = repo.commit('init');
    repo.write(CONFIG_FILE, loosened);
    repo.commit('add config');
    const step = runStep(repo, base);
    expect(step.code).toBe(0);
    expect(step.out).toContain('The base branch has no .riskannotate.json');
    expect(() => statSync(join(repo.dir, CONFIG_FILE))).toThrow();
  });

  it.each([
    ['an unknown base commit', '0123456789abcdef0123456789abcdef01234567'],
    ['an empty base commit', ''],
  ])('fails closed on %s', (_label, sha) => {
    const repo = createRepo();
    repos.push(repo);
    repo.write(CONFIG_FILE, configText);
    repo.commit('init');
    const step = runStep(repo, sha);
    expect(step.code).not.toBe(0);
    // The working-tree config is left alone, and the job stops before the action runs.
    expect(readFileSync(join(repo.dir, CONFIG_FILE), 'utf8')).toBe(configText);
  });

  it('fails closed when the base config is a symlink', () => {
    const repo = createRepo();
    repos.push(repo);
    // A symlink entry in the base tree, created without touching the filesystem.
    const link = spawnSync('git', ['hash-object', '-w', '--stdin'], {
      cwd: repo.dir,
      input: 'target.json',
      encoding: 'utf8',
    }).stdout.trim();
    repo.git('update-index', '--add', '--cacheinfo', `120000,${link},${CONFIG_FILE}`);
    repo.git('commit', '-q', '-m', 'symlinked config');
    const base = repo.git('rev-parse', 'HEAD').trim();
    const step = runStep(repo, base);
    expect(step.code).toBe(1);
    expect(step.out).toContain('is not a regular file (mode 120000)');
  });
});

it('invalid configs still fail closed with exit 1 (unchanged CLI behavior)', () => {
  const repo = createRepo();
  repos.push(repo);
  repo.write('a.txt', 'a\n');
  repo.commit('init');
  repo.write('a.txt', 'b\n');
  repo.write(CONFIG_FILE, '{"version":1,"sensitivePaths":["../app/**"]}');
  repo.commit('change');
  const run = cli([], repo.dir);
  expect(run.code).toBe(EXIT_ERROR);
  expect(run.stdout).toBe('');
});

it('keeps the fixture small: the PR overlay only edits files that exist in the base', () => {
  const base = listFiles(join(EXAMPLE, 'fixture', 'base'));
  const pr = listFiles(join(EXAMPLE, 'fixture', 'pr'));
  expect(base).toHaveLength(11);
  expect(pr).toHaveLength(10);
  expect(pr.every((p) => base.includes(p))).toBe(true);
});
