import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    'exports/index': 'src/exports/index.ts',
    'test/utils': 'test/utils.ts',
  },
  exports: { enabled: false },
});
