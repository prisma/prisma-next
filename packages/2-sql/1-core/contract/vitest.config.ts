import { timeouts } from '@prisma-next/test-utils';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: timeouts.default,
    hookTimeout: timeouts.default,
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
        '**/types.ts',
        'src/index.ts', // Barrel file with only re-exports
        'src/pack-types.ts', // Pure type definitions, no executable code
      ],
      thresholds: {
        lines: 90,
        branches: 85,
        functions: 92,
        statements: 91,
      },
    },
  },
});
