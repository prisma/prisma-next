import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import { timeouts } from '@prisma-next/test-utils';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
  },
});
