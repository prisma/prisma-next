import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'mongodb-types': 'src/exports/mongodb-types.ts',
  },
});
