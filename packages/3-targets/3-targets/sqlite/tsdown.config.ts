import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/exports/pack.ts', 'src/exports/runtime.ts'],
});
