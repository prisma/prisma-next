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
      include: ['src/**/*.ts'],
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
        'src/utils/guards.ts', // Type guards tested indirectly through integration tests
      ],
      thresholds: {
        lines: 96,
        branches: 95,
        functions: 95,
        statements: 96,
      },
    },
  },
});
