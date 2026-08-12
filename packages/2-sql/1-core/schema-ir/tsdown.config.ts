import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/exports/naming.ts', 'src/exports/types.ts'],
});
