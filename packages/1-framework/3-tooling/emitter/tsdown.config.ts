import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    '.': 'src/exports/index.ts',
    'test/utils': 'test/utils.ts',
  },
});
