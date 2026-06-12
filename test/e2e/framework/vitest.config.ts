import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test-d.ts'],
    // Keep V8 PKU JIT write-protection disabled in the e2e worker forks. The
    // PGlite (WASM) WAL-teardown crash (Check failed: jit_page_->allocations_
    // .erase) was largely fixed upstream in @prisma/dev 0.24.12, but this is
    // the highest-churn PGlite suite and runs files in parallel, where a
    // residual V8 ThreadIsolation race still aborts the worker ~30% of runs.
    // The flag (rejected in NODE_OPTIONS) removes the crashing code path; it is
    // a no-op on macOS. Other suites stayed green on 0.24.12 without it.
    execArgv: ['--no-memory-protection-keys'],
    testTimeout: timeouts.databaseOperation,
    hookTimeout: timeouts.databaseOperation,
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
