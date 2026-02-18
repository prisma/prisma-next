import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/exports/sql.ts'],
});
