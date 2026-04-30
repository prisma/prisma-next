import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  exports: { enabled: false },
});
