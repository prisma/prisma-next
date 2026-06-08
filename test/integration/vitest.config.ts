import { pgliteWorkerExecArgv, timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Disable the V8 PKU JIT hardening that crashes PGlite WASM teardown on
    // Linux CI; see pgliteWorkerExecArgv in @prisma-next/test-utils.
    execArgv: pgliteWorkerExecArgv,
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
