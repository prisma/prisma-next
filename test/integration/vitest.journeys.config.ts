import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/cli-journeys/**/*.e2e.test.ts'],
    testTimeout: timeouts.spinUpPpgDev,
    hookTimeout: timeouts.spinUpPpgDev,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 4,
      },
    },
  },
});
