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
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'dist/**',
        'test/**',
        '**/*.test.ts',
        '**/*.test-d.ts',
        '**/*.config.ts',
        '**/exports/**',
        '**/types.ts',
        'src/core/descriptor-meta.ts',
      ],
      thresholds: {
        lines: 84,
        branches: 77,
        functions: 88,
        statements: 84,
      },
    },
  },
});
