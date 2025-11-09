import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const workspaceRoot = resolve(__dirname, '../../..');

export default defineConfig({
  resolve: {
    alias: {
      '@prisma-next/plan': resolve(workspaceRoot, 'packages/core/plan/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'dist/**',
        'test/**',
        '**/*.test.ts',
        '**/*.test-d.ts',
        '**/*.config.ts',
        '**/exports/**',
        '**/orm-types.ts', // Types-only file
      ],
      thresholds: {
        lines: 90,
        branches: 80,
        functions: 93,
        statements: 90,
      },
    },
  },
});
