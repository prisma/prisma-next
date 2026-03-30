import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    postgres: 'src/exports/postgres.ts',
  },
  exports: { enabled: false },
});
