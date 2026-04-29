import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/exports/types.ts',
    'src/exports/errors.ts',
    'src/exports/ast.ts',
    'src/exports/expression.ts',
    'src/exports/plan.ts',
    'src/exports/query-lane-context.ts',
  ],
});
