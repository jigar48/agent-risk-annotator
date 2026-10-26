import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONFIG_FILE,
  ConfigError,
  MAX_CONFIG_BYTES,
  loadConfig,
  parseConfig,
} from '../src/config.js';
import { MAX_PATTERN_LENGTH, MAX_SENSITIVE_PATHS } from '../src/sensitive-paths.js';

const bytes = (text: string) => new TextEncoder().encode(text);
const parse = (text: string) => parseConfig(bytes(text));
const config = (value: unknown) => parse(JSON.stringify(value));

function errorOf(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err as ConfigError;
  }
  throw new Error('expected a ConfigError');
}

describe('parseConfig', () => {
  it('accepts the documented example', () => {
    expect(config({ version: 1, sensitivePaths: ['src/payments/**', 'src/checkout/**'] })).toEqual({
      sensitivePaths: ['src/checkout/**', 'src/payments/**'],
    });
  });

  it('treats a missing or empty sensitivePaths as no patterns', () => {
    expect(config({ version: 1 })).toEqual({ sensitivePaths: [] });
    expect(config({ version: 1, sensitivePaths: [] })).toEqual({ sensitivePaths: [] });
  });

  it('normalizes, dedupes and sorts exactly like --sensitive-path', () => {
    expect(
      config({
        version: 1,
        sensitivePaths: ['src/z/**', './src/a/**', 'src\\z\\**', 'src/a/', 'settings.py'],
      }),
    ).toEqual({ sensitivePaths: ['settings.py', 'src/a/**', 'src/z/**'] });
  });

  it('accepts a UTF-8 byte-order mark and surrounding whitespace', () => {
    expect(parse('\uFEFF\n  { "version": 1, "sensitivePaths": ["a/**"] }\n')).toEqual({
      sensitivePaths: ['a/**'],
    });
  });

  it.each([
    ['{', /invalid JSON/],
    ['{ "version": 1, }', /invalid JSON/],
    ['', /invalid JSON/],
    ['// comment\n{ "version": 1 }', /invalid JSON/],
    ['[]', /must contain a JSON object/],
    ['null', /must contain a JSON object/],
    ['1', /must contain a JSON object/],
    ['"version"', /must contain a JSON object/],
  ])('rejects malformed content %j', (text, message) => {
    expect(errorOf(() => parse(text)).message).toMatch(message);
  });

  it('never echoes raw control characters from a malformed file', () => {
    const message = errorOf(() => parse('{ "x\u001b[31m": ')).message;
    expect(message).toMatch(/^\.riskannotate\.json: invalid JSON/);
    expect(message).not.toContain('\u001b');
  });

  it('rejects invalid UTF-8', () => {
    expect(errorOf(() => parseConfig(new Uint8Array([0x7b, 0xff, 0x7d]))).message).toMatch(
      /not valid UTF-8/,
    );
  });

  it.each([
    [{ sensitivePaths: [] }, /missing required property "version"/],
    [{ version: 2 }, /unsupported version 2; .* supports version 1/],
    [{ version: 0 }, /unsupported version 0/],
    [{ version: '1' }, /unsupported version "1"/],
    [{ version: 1.5 }, /unsupported version 1\.5/],
    [{ version: null }, /unsupported version null/],
  ])('rejects version in %j', (value, message) => {
    expect(errorOf(() => config(value)).message).toMatch(message);
  });

  it.each([
    [{ version: 1, ignore: ['x'] }, '"ignore"'],
    [{ version: 1, severity: { E: 'LOW' } }, '"severity"'],
    [{ version: 1, disabledRules: ['E'] }, '"disabledRules"'],
    [{ version: 1, sensitivepaths: ['x'] }, '"sensitivepaths"'],
    [{ version: 1, $schema: 'https://example.invalid' }, '"$schema"'],
  ])('rejects unknown property in %j, so nothing can suppress findings', (value, key) => {
    const message = errorOf(() => config(value)).message;
    expect(message).toContain(`unknown property ${key}`);
    expect(message).toContain('supported properties: "version", "sensitivePaths"');
  });

  it('rejects prototype-polluting keys without touching Object.prototype', () => {
    for (const text of [
      '{ "version": 1, "__proto__": { "polluted": true } }',
      '{ "version": 1, "constructor": { "prototype": { "polluted": true } } }',
    ]) {
      expect(errorOf(() => parse(text)).message).toMatch(/unknown property/);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    [{ version: 1, sensitivePaths: 'src/**' }, /"sensitivePaths" must be an array .*got string/],
    [{ version: 1, sensitivePaths: { a: 1 } }, /must be an array .*got object/],
    [{ version: 1, sensitivePaths: null }, /must be an array .*got null/],
    [
      { version: 1, sensitivePaths: ['ok/**', 3] },
      /sensitivePaths\[1\]: must be a string \(got number\)/,
    ],
    [
      { version: 1, sensitivePaths: [['a']] },
      /sensitivePaths\[0\]: must be a string \(got array\)/,
    ],
  ])('rejects sensitivePaths shape %j', (value, message) => {
    expect(errorOf(() => config(value)).message).toMatch(message);
  });

  it.each([
    ['../outside/**', /"\.\." segments are not allowed/],
    ['src/../../etc/**', /"\.\." segments are not allowed/],
    ['/etc/passwd', /not an absolute path/],
    ['C:\\repo\\**', /not an absolute path/],
    ['\\\\server\\share\\x', /not an absolute path/],
    ['src/*.{ts,js}', /unsupported glob syntax "\{"/],
    ['src/[ab].ts', /unsupported glob syntax "\["/],
    ['!src/keep/**', /negated patterns/],
    ['src/a**b', /must be a whole path segment/],
    ['', /pattern is empty/],
    [' src/x', /leading or trailing whitespace/],
    ['src/\u001b[31mx', /control characters/],
    ['src/\u009b31mx', /control or bidirectional characters/],
    ['src/\u202epay.ts', /control or bidirectional characters/],
    ['x'.repeat(MAX_PATTERN_LENGTH + 1), /longer than 256 characters/],
  ])('rejects invalid pattern %j, naming its index', (pattern, message) => {
    const err = errorOf(() => config({ version: 1, sensitivePaths: ['ok/**', pattern] }));
    expect(err.message).toMatch(/^\.riskannotate\.json sensitivePaths\[1\] /);
    expect(err.message).toMatch(message);
    // Never echoes raw control characters back to the terminal.
    // eslint-disable-next-line no-control-regex
    expect(err.message).not.toMatch(/[\u0000-\u001f\u0080-\u009f\u202e]/);
  });

  it(`allows up to ${MAX_SENSITIVE_PATHS} unique patterns`, () => {
    const many = Array.from({ length: MAX_SENSITIVE_PATHS }, (_, i) => `p${i}/**`);
    expect(config({ version: 1, sensitivePaths: many }).sensitivePaths).toHaveLength(100);
    // Duplicates don't count against the cap.
    expect(config({ version: 1, sensitivePaths: [...many, ...many] }).sensitivePaths).toHaveLength(
      100,
    );
    const tooMany = [...many, 'one/more/**'];
    expect(errorOf(() => config({ version: 1, sensitivePaths: tooMany })).message).toMatch(
      /at most 100 unique "sensitivePaths" patterns are allowed \(got 101\)/,
    );
  });
});

describe('loadConfig', () => {
  let dir: string;
  const make = () => (dir = mkdtempSync(join(tmpdir(), 'risk-annotate-config-')));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null when there is no configuration', () => {
    make();
    expect(loadConfig(dir)).toBeNull();
  });

  it('reads the file at the given root', () => {
    make();
    writeFileSync(
      join(dir, CONFIG_FILE),
      '{ "version": 1, "sensitivePaths": ["src/payments/**"] }',
    );
    expect(loadConfig(dir)).toEqual({ sensitivePaths: ['src/payments/**'] });
  });

  it('ignores files with the same name in subdirectories or a parent directory', () => {
    make();
    const root = join(dir, 'repo');
    mkdirSync(join(root, 'nested'), { recursive: true });
    writeFileSync(join(dir, CONFIG_FILE), '{ "version": 1, "sensitivePaths": ["parent/**"] }');
    writeFileSync(
      join(root, 'nested', CONFIG_FILE),
      '{ "version": 1, "sensitivePaths": ["n/**"] }',
    );
    expect(loadConfig(root)).toBeNull();
  });

  it('rejects a directory with the config file name', () => {
    make();
    mkdirSync(join(dir, CONFIG_FILE));
    expect(errorOf(() => loadConfig(dir)).message).toMatch(/is not a regular file/);
  });

  it('rejects a symlinked configuration, even one pointing at a valid file', (ctx) => {
    make();
    const target = join(dir, 'real.json');
    writeFileSync(target, '{ "version": 1, "sensitivePaths": ["x/**"] }');
    try {
      symlinkSync(target, join(dir, CONFIG_FILE), 'file');
    } catch {
      // Windows without Developer Mode can't create symlinks; nothing to test there.
      ctx.skip();
    }
    expect(errorOf(() => loadConfig(dir)).message).toMatch(/is a symbolic link/);
  });

  it('rejects a dangling symlink instead of treating it as missing', (ctx) => {
    make();
    try {
      symlinkSync(join(dir, 'nowhere.json'), join(dir, CONFIG_FILE), 'file');
    } catch {
      ctx.skip();
    }
    expect(errorOf(() => loadConfig(dir)).message).toMatch(/is a symbolic link/);
  });

  it(`accepts exactly ${MAX_CONFIG_BYTES} bytes and rejects one more`, () => {
    make();
    const body = '{ "version": 1 }';
    const exact = body + ' '.repeat(MAX_CONFIG_BYTES - body.length);
    writeFileSync(join(dir, CONFIG_FILE), exact);
    expect(loadConfig(dir)).toEqual({ sensitivePaths: [] });

    writeFileSync(join(dir, CONFIG_FILE), exact + ' ');
    expect(errorOf(() => loadConfig(dir)).message).toMatch(/larger than 32 KiB/);
  });
});
