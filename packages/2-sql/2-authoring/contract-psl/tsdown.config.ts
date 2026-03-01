import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/exports/index.ts', 'src/exports/provider.ts'],
});
