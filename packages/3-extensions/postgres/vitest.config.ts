import { pgliteWorkerExecArgv, timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Disable the V8 PKU JIT hardening that crashes PGlite WASM teardown on
    // Linux CI; see pgliteWorkerExecArgv in @prisma-next/test-utils.
    execArgv: pgliteWorkerExecArgv,
    globals: true,
    environment: 'node',
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'dist/**',
        'test/**',
        '**/*.test.ts',
        '**/*.test-d.ts',
        '**/*.config.ts',
        '**/exports/**',
      ],
      reporter: ['text', 'json', 'html'],
    },
  },
});
