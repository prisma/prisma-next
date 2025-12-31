import { timeouts } from '@prisma-next/test-utils';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    pool: 'threads',
    maxWorkers: 1,
    isolate: false,
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
  },
});
