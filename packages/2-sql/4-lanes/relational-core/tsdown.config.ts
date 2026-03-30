import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/exports/schema.ts',
    'src/exports/param.ts',
    'src/exports/types.ts',
    'src/exports/operations-registry.ts',
    'src/exports/errors.ts',
    'src/exports/ast.ts',
    'src/exports/plan.ts',
    'src/exports/query-operations.ts',
    'src/exports/query-lane-context.ts',
    'src/exports/guards.ts',
    'src/exports/utils/guards.ts',
  ],
});
