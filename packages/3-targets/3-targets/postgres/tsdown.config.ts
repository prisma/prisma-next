import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/control.ts',
    'src/exports/default-normalizer.ts',
    'src/exports/migration.ts',
    'src/exports/native-type-normalizer.ts',
    'src/exports/pack.ts',
    'src/exports/runtime.ts',
    'src/exports/sql-utils.ts',
  ],
});
