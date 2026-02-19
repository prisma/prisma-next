import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    'exports/index': 'src/exports/index.ts',
    'test/utils': 'test/utils.ts',
  },
  // Keep manual exports to preserve stable root/subpath mapping.
  exports: { enabled: false },
});
