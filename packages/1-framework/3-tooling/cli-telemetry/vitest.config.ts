import { pgliteWorkerExecArgv } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Disable the V8 PKU JIT hardening that crashes PGlite WASM teardown on
    // Linux CI; see pgliteWorkerExecArgv in @prisma-next/test-utils.
    execArgv: pgliteWorkerExecArgv,
    // Mirror the root config's harness short-circuit so the probe test in
    // `test/no-spawn-in-tests.test.ts` works under both `pnpm test:packages`
    // (root vitest, which injects the env) and `pnpm --filter @prisma-next/cli-telemetry test`
    // (vitest reading only this package's config).
    env: {
      PRISMA_NEXT_DISABLE_TELEMETRY: '1',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['dist/**', 'test/**', '**/*.test.ts', '**/*.config.ts', '**/exports/**'],
    },
  },
});
