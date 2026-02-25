import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/abstract-ops.ts',
    'src/exports/config-types.ts',
    'src/exports/config-validation.ts',
    'src/exports/errors.ts',
    'src/exports/types.ts',
    'src/exports/stack.ts',
    'src/exports/emission.ts',
    'src/exports/schema-view.ts',
  ],
});
