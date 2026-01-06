import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'test/utils': 'test/utils.ts',
  },
});
