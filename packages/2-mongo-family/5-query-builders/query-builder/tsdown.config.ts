import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'exports/contract-free': 'src/exports/contract-free.ts',
  },
});
