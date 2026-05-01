import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/index.ts',
    'src/exports/control.ts',
    'src/exports/runtime.ts',
    'src/exports/middleware.ts',
    'src/exports/column-types.ts',
  ],
});
