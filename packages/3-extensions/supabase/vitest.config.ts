import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Disable V8 PKU JIT write-protection in the test worker forks: PGlite
    // (WASM) teardown intermittently aborts on Linux without it. No-op on
    // macOS.
    execArgv: ['--no-memory-protection-keys'],
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
    // Restoring the full 33-table Supabase reference fixture into PGlite is
    // the heaviest single WASM operation in the suite, and on the slower CI
    // runners it intermittently trips the residual PGlite (WASM) abort that
    // --no-memory-protection-keys only partially suppresses ("Connection
    // terminated unexpectedly" during the reference restore). The crash does
    // not reproduce locally; a re-run with a fresh dev database clears it.
    retry: process.env['CI'] ? 2 : 0,
  },
});
