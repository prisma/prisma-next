import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Note: do not change to 'threads', it will cause the failure
    // `TypeError: process.chdir() is not supported in workers`.
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
    env: {
      CI: 'true',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
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
        'src/commands/db-update.ts',
        'src/commands/db-verify.ts',
        'src/commands/migration-apply.ts',
        'src/commands/migration-plan.ts',
        'src/commands/migration-show.ts',
        'src/commands/migration-status.ts',
        'src/commands/migration-verify.ts',
        // Exclude error factory functions - just constructors
        'src/utils/cli-errors.ts',
        // Exclude config loader - mostly file I/O and error handling, tested via e2e tests
        'src/config-loader.ts',
        // Exclude spinner and progress utilities - UI/UX code that's hard to test meaningfully
        'src/utils/spinner.ts',
        'src/utils/progress-adapter.ts',
        // Exclude migration command scaffold - orchestration code tested via e2e tests
        'src/utils/migration-command-scaffold.ts',
        // Exclude defensive error handling branches that are hard to test meaningfully
        'src/api/emit-contract.ts', // Non-Error exception handling (lines 104-105)
        'src/load-ts-contract.ts', // Bundle content undefined and non-Error exceptions (lines 170-171, 211)
        // Control API is tested via integration tests (test/integration/test/control-api.test.ts).
        // Unit tests with mocked components only test orchestration wiring, not real behavior.
        // Coverage is measured in integration tests, not package-level coverage.
        'src/control-api/**',
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
