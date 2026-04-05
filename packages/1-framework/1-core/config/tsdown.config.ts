import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/config-types.ts',
    'src/exports/config-validation.ts',
    'src/exports/types.ts',
  ],
});
