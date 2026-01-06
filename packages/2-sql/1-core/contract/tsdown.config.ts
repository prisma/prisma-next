import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/types.ts',
    'src/exports/validators.ts',
    'src/exports/factories.ts',
    'src/exports/pack-types.ts',
  ],
});
