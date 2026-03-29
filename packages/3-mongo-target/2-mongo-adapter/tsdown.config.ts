import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'codec-types': 'src/exports/codec-types.ts',
  },
});
