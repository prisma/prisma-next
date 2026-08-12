import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    'exports/index': 'src/exports/index.ts',
  },
  exports: { enabled: false },
});
