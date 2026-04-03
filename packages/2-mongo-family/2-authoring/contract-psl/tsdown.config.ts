import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'exports/provider': 'src/exports/provider.ts',
  },
});
