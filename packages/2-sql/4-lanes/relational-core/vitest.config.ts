import { defineConfig } from 'vitest/config';

export default defineConfig({
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
        '**/index.ts', // Re-export file
        '**/types.ts', // Types-only file
        'src/utils/guards.ts', // Type guards tested indirectly through integration tests
        'src/ast/adapter-types.ts', // Types-only file
        'src/ast/driver-types.ts', // Types-only file
        'src/ast/predicate.ts', // Simple factory functions tested indirectly through integration tests
        'src/query-lane-context.ts', // Types-only file
      ],
      thresholds: {
        // The thresholds were lowered to accommodate the AST deserializer
        // (`src/ast/parse.ts`) added under the AST-bound codec resolution
        // refactor. Its "unknown kind" defensive branches are exercised by
        // migration round-trip integration tests in `@prisma-next/sql-runtime`
        // and `@prisma-next/integration-tests`, which do not contribute to
        // this package's unit-coverage report.
        lines: 95,
        branches: 87,
        functions: 95,
        statements: 95,
      },
    },
  },
});
