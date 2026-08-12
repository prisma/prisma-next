import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: timeouts.spinUpMongoMemoryServer,
    hookTimeout: timeouts.spinUpMongoMemoryServer,
    fileParallelism: false,
    sequence: { groupOrder: 2 },
    typecheck: {
      enabled: true,
      include: ['test/**/*.test-d.ts'],
    },
  },
});
