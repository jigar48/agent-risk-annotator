import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import { createFixtureRepo } from './helpers/fixture.js';

function run(args: string[], cwd: string): string {
  let stdout = '';
  main(args, { stdout: (t) => (stdout += t), stderr: () => {}, cwd });
  return stdout;
}

describe('determinism', () => {
  it.each(['markdown', 'json', 'sarif'])(
    '%s: same repo twice, from root and a subdirectory → byte-identical',
    (format) => {
      const repo = createFixtureRepo();
      try {
        const a = run(['--format', format], repo.dir);
        const b = run(['--format', format], repo.dir);
        const c = run(['--format', format], join(repo.dir, 'src', 'auth'));
        expect(a.length).toBeGreaterThan(100);
        expect(b).toBe(a);
        expect(c).toBe(a);
      } finally {
        repo.cleanup();
      }
    },
  );

  it('two independently built copies of the fixture produce identical output', () => {
    const one = createFixtureRepo();
    const two = createFixtureRepo();
    try {
      expect(run(['--format', 'json'], two.dir)).toBe(run(['--format', 'json'], one.dir));
    } finally {
      one.cleanup();
      two.cleanup();
    }
  });
});
