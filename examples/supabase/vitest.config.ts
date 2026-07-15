import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Disable V8 PKU JIT write-protection in the test worker forks: PGlite
    // (WASM) teardown still intermittently aborts on Linux with
    // jit_page_->allocations_.erase even on @prisma/dev 0.24.12. No-op on macOS.
    execArgv: ['--no-memory-protection-keys'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
    // Restoring the full 33-table Supabase reference fixture into PGlite is the
    // heaviest single WASM operation in the suite, and on the slower CI runners
    // it intermittently trips the residual PGlite (WASM) abort that
    // --no-memory-protection-keys only partially suppresses ("Connection
    // terminated unexpectedly" during restoreSupabaseReference). The crash does
    // not reproduce locally; a re-run with a fresh dev database clears it.
    retry: process.env['CI'] ? 2 : 0,
  },
});
