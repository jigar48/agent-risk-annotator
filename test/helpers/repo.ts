import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TestRepo {
  dir: string;
  git(...args: string[]): string;
  write(path: string, content: string): void;
  remove(path: string): void;
  /** Stages everything and commits. Returns the new commit hash. */
  commit(message: string, author?: { name: string; email: string }): string;
  cleanup(): void;
}

/**
 * Throwaway repo in the OS temp dir. Identity, signing and line-ending config are set
 * locally so tests never depend on the developer's or CI runner's global git config.
 */
export function createRepo(): TestRepo {
  const dir = mkdtempSync(join(tmpdir(), 'risk-annotate-'));
  // Fixed, strictly increasing commit dates: same script → same commit hashes on every run
  // and machine, which keeps golden files that mention hashes stable.
  let tick = 0;
  const date = () => `${1_767_225_600 + tick * 60} +0000`; // 2026-01-01T00:00:00Z
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_AUTHOR_DATE: date(), GIT_COMMITTER_DATE: date() },
    });

  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test User');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.autocrlf', 'false');

  return {
    dir,
    git,
    write(path, content) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    },
    remove(path) {
      rmSync(join(dir, path));
    },
    commit(message, author) {
      git('add', '-A');
      tick++;
      const args = ['commit', '-q', '--allow-empty', '-m', message];
      if (author) args.push(`--author=${author.name} <${author.email}>`);
      git(...args);
      return git('rev-parse', 'HEAD').trim();
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** "line 1\nline 2\n…" with n lines. */
export function lines(n: number, label = 'line'): string {
  return Array.from({ length: n }, (_, i) => `${label} ${i + 1}\n`).join('');
}
