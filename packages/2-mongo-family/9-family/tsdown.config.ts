import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/control.ts',
    'src/exports/pack.ts',
    'src/exports/migration.ts',
    'src/exports/schema-verify.ts',
  ],
});
