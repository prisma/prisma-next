import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const testTimeout = (Number.parseFloat(process.env['TEST_TIMEOUT_MULTIPLIER'] ?? '1') || 1) * 500;

const contractTypesEntry = fileURLToPath(new URL('./src/exports/types.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@prisma-next/contract/types': contractTypesEntry,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout,
    hookTimeout: testTimeout,
    typecheck: {
      include: ['test/**/*.test-d.ts'],
    },
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
        'schemas/**',
        '**/types.ts',
        '**/contract-types.ts',
        '**/domain-types.ts',
      ],
      thresholds: {
        lines: 90,
        branches: 94,
        functions: 95,
        statements: 95,
      },
    },
  },
});
