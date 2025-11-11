import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
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
        '**/errors.ts', // Re-export file
        '**/index.ts', // Re-export file
        '**/types.ts', // Types-only file
      ],
      thresholds: {
        lines: 96,
        branches: 91,
        functions: 95,
        statements: 96,
      },
    },
  },
});
