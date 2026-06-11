import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test-d.ts'],
    testTimeout: timeouts.databaseOperation,
    hookTimeout: timeouts.databaseOperation,
    // The e2e suite drives real embedded databases (PGlite via @prisma/dev,
    // node:sqlite) whose connect / contract-verify / teardown timing is
    // load-sensitive on the slower CI runners (TEST_TIMEOUT_MULTIPLIER=2).
    // Those races are environment-specific and do not reproduce locally, so a
    // single re-run clears them; retry on CI to keep the suite deterministic.
    retry: process.env['CI'] ? 2 : 0,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'dist/**',
        'test/**',
        '**/*.test.ts',
        '**/*.test-d.ts',
        '**/*.config.ts',
        '**/exports/**',
      ],
    },
  },
});
