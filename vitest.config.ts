import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Tests spin up throwaway git repos; Windows CI runners are slow at this.
    testTimeout: 20_000,
  },
});
