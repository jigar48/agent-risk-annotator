import { createRepo, lines, type TestRepo } from './repo.js';

const pkg = (deps: Record<string, string>) =>
  JSON.stringify({ name: 'fixture', private: true, dependencies: deps }, null, 2) + '\n';

const lcov = [
  'SF:src/uncovered.ts',
  ...[1, 2, 3, 4, 5].map((n) => `DA:${n},0`),
  'end_of_record',
  'SF:src/a.ts',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `DA:${n},1`),
  'end_of_record',
  '',
].join('\n');

/**
 * A repo whose HEAD commit trips every rule A–H exactly once. Commit dates are pinned by
 * createRepo, so hashes (and therefore output) are identical on every run.
 */
export function createFixtureRepo(): TestRepo {
  const repo = createRepo();

  repo.write('package.json', pkg({ react: '18.3.1' }));
  repo.write('package-lock.json', '{ "lockfileVersion": 3 }\n');
  repo.write('src/a.ts', lines(10));
  repo.write('src/uncovered.ts', lines(5));
  repo.write('src/a.test.ts', lines(6, 'it'));
  repo.write('src/auth/login.ts', lines(4));
  repo.write('.github/workflows/ci.yml', 'on: push\n');
  repo.write('coverage/lcov.info', lcov);
  repo.commit('chore: initial import');

  repo.write('src/a.ts', lines(10).replace('line 2\n', 'line 2 guarded\n'));
  repo.commit('fix: guard against empty input in a');

  for (let i = 0; i < 3; i++) {
    repo.write(`docs/note-${i}.md`, lines(4));
    repo.commit(`docs: note ${i}`);
  }

  // The change under review.
  repo.write(
    'src/a.ts',
    lines(10).replace('line 2\n', 'line 2 guarded\n').replace('line 5\n', 'line 5 changed\n'),
  );
  repo.write('src/uncovered.ts', lines(5).replace('line 3\n', 'line 3 changed\n'));
  repo.write('package.json', pkg({ react: '18.3.1', zod: '3.23.8' }));
  repo.write('src/auth/login.ts', lines(4) + 'skipMfa();\n');
  repo.write('src/a.test.ts', lines(6, 'it').replace('it 2\nit 3\n', ''));
  repo.write('.github/workflows/ci.yml', 'on: [push, pull_request_target]\n');
  repo.write('src/big.ts', lines(20, 'generated'));
  repo.commit('feat: agent change');

  return repo;
}
