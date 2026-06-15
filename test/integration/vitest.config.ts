import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Disable V8 PKU JIT write-protection in the test worker forks: PGlite
    // (WASM) teardown still intermittently aborts on Linux with
    // jit_page_->allocations_.erase even on @prisma/dev 0.24.12. No-op on macOS.
    execArgv: ['--no-memory-protection-keys'],
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
    },
    testTimeout: timeouts.default,
    // Hook timeout needs to be higher than default (100ms) because beforeEach/afterEach
    // hooks often perform filesystem operations (creating/cleaning test directories)
    hookTimeout: timeouts.databaseOperation,
  },
});
