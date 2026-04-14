import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/exports/config.ts', 'src/exports/runtime.ts'],
});
