import { pgliteWorkerExecArgv, timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Disable the V8 PKU JIT hardening that crashes PGlite WASM teardown on
    // Linux CI; see pgliteWorkerExecArgv in @prisma-next/test-utils.
    execArgv: pgliteWorkerExecArgv,
    globals: true,
    environment: 'node',
    include: ['test/cli-journeys/**/*.e2e.test.ts'],
    testTimeout: timeouts.spinUpPpgDev,
    hookTimeout: timeouts.spinUpPpgDev,
    // Required (not a preference): journey helpers use process.chdir() and mock
    // process.exit/console globally. 'threads' would share these across tests.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,
      },
    },
  },
});
