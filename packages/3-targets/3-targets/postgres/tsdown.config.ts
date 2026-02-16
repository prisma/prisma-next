import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/exports/control.ts', 'src/exports/runtime.ts', 'src/exports/pack.ts'],
});
