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
        'src/lower-sql-plan.ts', // TODO(TML-1786): Add tests - currently 0% coverage
        'src/sql-marker.ts', // TODO(TML-1786): Add tests - currently 42% coverage
        'src/codecs/encoding.ts', // TODO(TML-1786): Add tests - currently 6% coverage
        'src/codecs/decoding.ts', // TODO(TML-1786): Add tests - currently 33% coverage
        'src/codecs/validation.ts', // TODO(TML-1786): Add tests - currently 50% coverage
      ],
      thresholds: {
        lines: 84,
        branches: 50,
        functions: 83, // TODO: Increase to 85% after adding tests for offline driver methods (lines 199, 207-214)
        statements: 84,
      },
    },
  },
});
