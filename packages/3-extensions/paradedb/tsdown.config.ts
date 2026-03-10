import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/exports/control.ts', 'src/exports/index-types.ts', 'src/exports/pack.ts'],
});
