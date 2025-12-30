import { timeouts } from '@prisma-next/test-utils';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
    env: {
      CI: 'true',
    },
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
        'src/cli.ts',
        // Exclude formatting/wrangling files - these are tested via e2e tests
        'src/utils/output.ts',
        'src/utils/command-helpers.ts',
        'src/utils/global-flags.ts',
        // Exclude command files - mostly Commander.js setup and delegation to family instance,
        // tested via e2e tests in @prisma-next/integration-tests (test/integration/test/cli.*.e2e.test.ts)
        'src/commands/contract-emit.ts',
        'src/commands/db-init.ts',
        'src/commands/db-introspect.ts',
        'src/commands/db-schema-verify.ts',
        'src/commands/db-sign.ts',
        'src/commands/db-verify.ts',
        // Exclude error factory functions - just constructors
        'src/utils/cli-errors.ts',
        // Exclude config loader - mostly file I/O and error handling, tested via e2e tests
        'src/config-loader.ts',
        // Exclude spinner utility - UI/UX code that's hard to test meaningfully
        'src/utils/spinner.ts',
        // Exclude defensive error handling branches that are hard to test meaningfully
        'src/pack-loading.ts', // Non-Error exception handling (lines 12, 20)
        'src/api/emit-contract.ts', // Non-Error exception handling (lines 104-105)
        'src/load-ts-contract.ts', // Bundle content undefined and non-Error exceptions (lines 170-171, 211)
      ],
      thresholds: {
        lines: 95,
        branches: 95,
        functions: 95,
        statements: 95,
      },
    },
  },
});
