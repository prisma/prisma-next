import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    legacy: 'src/exports/legacy.ts',
  },
  exports: { enabled: false },
});
