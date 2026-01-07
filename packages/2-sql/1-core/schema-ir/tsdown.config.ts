import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/exports/types.ts', 'src/index.ts'],
});
