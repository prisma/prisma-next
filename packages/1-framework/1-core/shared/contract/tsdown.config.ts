import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/types.ts',
    'src/exports/pack-manifest-types.ts',
    'src/exports/ir.ts',
    'src/exports/framework-components.ts',
  ],
});
