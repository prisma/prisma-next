import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/exports/errors.ts', 'src/exports/types.ts'],
});
