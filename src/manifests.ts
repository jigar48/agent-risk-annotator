/**
 * Direct-dependency extraction for the manifests rules D and H understand.
 * Each parser returns name → version spec, or null when the file can't be parsed (rules
 * then stay silent rather than guess). Parsing is intentionally shallow: enough to see
 * which dependencies exist, not to resolve them.
 */
export type Deps = Map<string, string>;

export type ManifestKind = 'npm' | 'composer' | 'pip' | 'pyproject' | 'cargo' | 'go';

const BY_BASENAME: Record<string, ManifestKind> = {
  'package.json': 'npm',
  'composer.json': 'composer',
  'pyproject.toml': 'pyproject',
  'Cargo.toml': 'cargo',
  'go.mod': 'go',
};

export function manifestKind(path: string): ManifestKind | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (BY_BASENAME[base]) return BY_BASENAME[base];
  if (/^requirements[\w.-]*\.txt$/.test(base)) return 'pip';
  return null;
}

export function parseDeps(kind: ManifestKind, text: string): Deps | null {
  switch (kind) {
    case 'npm':
      return jsonDeps(text, [
        'dependencies',
        'devDependencies',
        'optionalDependencies',
        'peerDependencies',
      ]);
    case 'composer':
      return jsonDeps(
        text,
        ['require', 'require-dev'],
        (n) => n !== 'php' && !/^(ext|lib)-/.test(n),
      );
    case 'pip':
      return requirementsDeps(text);
    case 'pyproject':
      return pyprojectDeps(text);
    case 'cargo':
      return cargoDeps(text);
    case 'go':
      return goModDeps(text);
  }
}

export function depsEqual(a: Deps, b: Deps): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function jsonDeps(text: string, fields: string[], keep: (name: string) => boolean = () => true) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;
  const deps: Deps = new Map();
  for (const field of fields) {
    const section = (json as Record<string, unknown>)[field];
    if (typeof section !== 'object' || section === null) continue;
    for (const [name, spec] of Object.entries(section)) {
      if (keep(name)) deps.set(name, String(spec));
    }
  }
  return deps;
}

/** PEP 503 normalization so "Foo_Bar" and "foo-bar" are one package. */
function pyName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/** "requests[socks]>=2.0 ; python_version>'3'" → ["requests", ">=2.0 ; ..."] */
function pep508(req: string): [string, string] | null {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/.exec(req);
  return m ? [pyName(m[1] as string), (m[2] as string).trim()] : null;
}

function requirementsDeps(text: string): Deps {
  const deps: Deps = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (line === '' || line.startsWith('-')) continue; // -r, -e, --index-url, …
    const parsed = pep508(line);
    if (parsed) deps.set(...parsed);
  }
  return deps;
}

function pyprojectDeps(text: string): Deps | null {
  const entries = readToml(text);
  if (!entries) return null;
  const deps: Deps = new Map();
  const addReqs = (raw: string) => {
    for (const s of tomlStrings(raw)) {
      const parsed = pep508(s);
      if (parsed) deps.set(...parsed);
    }
  };
  for (const { table, key, value } of entries) {
    if (table === 'project' && key === 'dependencies') addReqs(value);
    else if (table === 'project.optional-dependencies' || table === 'dependency-groups')
      addReqs(value);
    else if (
      (table === 'tool.poetry.dependencies' ||
        table === 'tool.poetry.dev-dependencies' ||
        /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(table)) &&
      key !== 'python'
    ) {
      deps.set(pyName(key), value);
    }
  }
  return deps;
}

const CARGO_TABLE = /^(?:target\..+\.|workspace\.)?(?:dev-|build-)?dependencies$/;

function cargoDeps(text: string): Deps | null {
  const entries = readToml(text);
  if (!entries) return null;
  const deps: Deps = new Map();
  for (const { table, key, value } of entries) {
    if (CARGO_TABLE.test(table)) {
      deps.set(key, value);
      continue;
    }
    // [dependencies.serde] version = "1" — the table header names the crate.
    const dot = table.lastIndexOf('.');
    if (dot !== -1 && CARGO_TABLE.test(table.slice(0, dot))) {
      const name = table.slice(dot + 1);
      deps.set(name, `${deps.get(name) ?? ''}${key}=${value};`);
    }
  }
  return deps;
}

function goModDeps(text: string): Deps {
  const deps: Deps = new Map();
  let inBlock = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (inBlock && line === ')') {
      inBlock = false;
      continue;
    }
    if (line === 'require (') {
      inBlock = true;
      continue;
    }
    const body = inBlock ? line : line.startsWith('require ') ? line.slice(8).trim() : null;
    if (!body || body.startsWith('//') || /\/\/\s*indirect\b/.test(body)) continue;
    const [mod, version] = body.split(/\s+/);
    if (mod && version) deps.set(mod, version);
  }
  return deps;
}

export interface TomlEntry {
  table: string;
  key: string;
  /** Raw value text; strings keep their quotes stripped, arrays/inline tables stay raw. */
  value: string;
}

/**
 * Just enough TOML for manifests: [table] / [[array]] headers, `key = value` with string,
 * multi-line array and inline-table values. Returns null on clearly broken input.
 */
export function readToml(text: string): TomlEntry[] | null {
  const entries: TomlEntry[] = [];
  const lines = text.split('\n');
  let table = '';
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i] as string).trim();
    if (line === '') continue;
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) {
      table = (header[1] as string)
        .split('.')
        .map((s) => s.trim().replace(/^"(.*)"$/, '$1'))
        .join('.');
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) return null;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^"(.*)"$/, '$1');
    let value = line.slice(eq + 1).trim();
    // Multi-line arrays / inline tables: keep reading until brackets balance.
    while (depth(value) > 0 && i + 1 < lines.length) {
      value += '\n' + stripComment(lines[++i] as string).trim();
    }
    if (depth(value) !== 0) return null;
    entries.push({ table, key, value: value.replace(/^"(.*)"$/s, '$1') });
  }
  return entries;
}

/** Quoted strings inside a raw TOML value (array elements). */
function tomlStrings(raw: string): string[] {
  return [...raw.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2] ?? '');
}

function depth(s: string): number {
  let d = 0;
  for (const m of s.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '').matchAll(/[[\]{}]/g)) {
    d += m[0] === '[' || m[0] === '{' ? 1 : -1;
  }
  return d;
}

function stripComment(line: string): string {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) {
      if (c === '\\' && inStr === '"') i++;
      else if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") inStr = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}
