import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/pack.ts',
    'src/exports/codec-types.ts',
    'src/exports/control.ts',
    'src/exports/migration.ts',
  ],
});
