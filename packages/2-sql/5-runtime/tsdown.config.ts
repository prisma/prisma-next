import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'test/utils': 'test/utils.ts',
  },
  external: ['@prisma-next/test-utils', '@prisma/dev', 'pg'],
  exports: { enabled: false },
});
