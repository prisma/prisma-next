import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: timeouts.default,
    // Hook timeout needs to be higher than default (100ms) because beforeEach/afterEach
    // hooks often perform filesystem operations (creating/cleaning test directories)
    hookTimeout: timeouts.databaseOperation,
  },
});
