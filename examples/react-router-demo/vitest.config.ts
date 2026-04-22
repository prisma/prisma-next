import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'threads',
    maxWorkers: 1,
    isolate: false,
    include: ['test/**/*.test.ts'],
    // Per-test timeout is applied in the smoke test via `timeouts.spinUpPpgDev`;
    // use that as the hook ceiling too so `beforeEach`/`afterEach` can boot and
    // tear down @prisma/dev without the default 5s cap biting.
    testTimeout: timeouts.spinUpPpgDev,
    hookTimeout: timeouts.spinUpPpgDev,
  },
});
