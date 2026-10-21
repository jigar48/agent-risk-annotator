import { describe, expect, it } from 'vitest';
import { depsEqual, manifestKind, parseDeps, readToml } from '../src/manifests.js';

const obj = (m: Map<string, string> | null) => (m ? Object.fromEntries(m) : null);

describe('manifestKind', () => {
  it.each([
    ['package.json', 'npm'],
    ['apps/web/package.json', 'npm'],
    ['composer.json', 'composer'],
    ['requirements.txt', 'pip'],
    ['requirements-dev.txt', 'pip'],
    ['requirements/base.txt', null],
    ['pyproject.toml', 'pyproject'],
    ['crates/x/Cargo.toml', 'cargo'],
    ['go.mod', 'go'],
    ['package-lock.json', null],
  ])('%s → %s', (path, kind) => {
    expect(manifestKind(path)).toBe(kind);
  });
});

describe('parseDeps', () => {
  it('npm: all dependency sections; null on invalid JSON', () => {
    const text = JSON.stringify({
      name: 'x',
      dependencies: { react: '^18.3.1' },
      devDependencies: { vitest: '^2.1.4' },
      peerDependencies: { 'react-dom': '*' },
      scripts: { test: 'vitest' },
    });
    expect(obj(parseDeps('npm', text))).toEqual({
      react: '^18.3.1',
      vitest: '^2.1.4',
      'react-dom': '*',
    });
    expect(parseDeps('npm', '{ broken')).toBeNull();
  });

  it('composer: skips php and platform extensions', () => {
    const text = JSON.stringify({
      require: { php: '>=8.1', 'ext-json': '*', 'monolog/monolog': '^3.0' },
      'require-dev': { 'phpunit/phpunit': '^10' },
    });
    expect(obj(parseDeps('composer', text))).toEqual({
      'monolog/monolog': '^3.0',
      'phpunit/phpunit': '^10',
    });
  });

  it('requirements.txt: names normalized, comments and options skipped', () => {
    const text = [
      '# pinned',
      'Django==4.2.7  # web',
      'requests[socks]>=2.31',
      'typing_extensions',
      '-r base.txt',
      '--index-url https://example.invalid/simple',
      '',
    ].join('\n');
    expect(obj(parseDeps('pip', text))).toEqual({
      django: '==4.2.7',
      requests: '>=2.31',
      'typing-extensions': '',
    });
  });

  it('pyproject: PEP 621, optional deps, dependency groups and poetry tables', () => {
    const text = `
[project]
name = "x"
dependencies = [
  "httpx>=0.27",  # client
  "Pydantic~=2.0",
]

[project.optional-dependencies]
cli = ["rich"]

[dependency-groups]
dev = ["pytest>=8"]

[tool.poetry.dependencies]
python = "^3.11"
fastapi = "^0.115"

[tool.poetry.group.lint.dependencies]
ruff = { version = "^0.6", optional = true }
`;
    expect(obj(parseDeps('pyproject', text))).toEqual({
      httpx: '>=0.27',
      pydantic: '~=2.0',
      rich: '',
      pytest: '>=8',
      fastapi: '^0.115',
      ruff: '{ version = "^0.6", optional = true }',
    });
  });

  it('cargo: dependency tables, target tables, and [dependencies.name] headers', () => {
    const text = `
[package]
name = "x"
version = "0.1.0"

[dependencies]
serde = { version = "1", features = ["derive"] }
anyhow = "1.0"

[dev-dependencies]
proptest = "1"

[target.'cfg(unix)'.dependencies]
libc = "0.2"

[dependencies.tokio]
version = "1"
features = ["full"]
`;
    expect(obj(parseDeps('cargo', text))).toEqual({
      serde: '{ version = "1", features = ["derive"] }',
      anyhow: '1.0',
      proptest: '1',
      libc: '0.2',
      tokio: 'version=1;features=["full"];',
    });
  });

  it('go.mod: single and block requires, indirect skipped', () => {
    const text = `module example.com/x

go 1.22

require github.com/pkg/errors v0.9.1

require (
\tgolang.org/x/sync v0.8.0
\tgithub.com/davecgh/go-spew v1.1.1 // indirect
)
`;
    expect(obj(parseDeps('go', text))).toEqual({
      'github.com/pkg/errors': 'v0.9.1',
      'golang.org/x/sync': 'v0.8.0',
    });
  });
});

describe('readToml', () => {
  it('keeps # inside strings and rejects garbage', () => {
    expect(readToml('[a]\nk = "x # y" # real comment\n')).toEqual([
      { table: 'a', key: 'k', value: 'x # y' },
    ]);
    expect(readToml('this is not toml\n')).toBeNull();
    expect(readToml('k = [1, 2\n')).toBeNull();
  });
});

describe('depsEqual', () => {
  it('compares names and specs', () => {
    const a = new Map([['x', '1']]);
    expect(depsEqual(a, new Map([['x', '1']]))).toBe(true);
    expect(depsEqual(a, new Map([['x', '2']]))).toBe(false);
    expect(depsEqual(a, new Map())).toBe(false);
  });
});
