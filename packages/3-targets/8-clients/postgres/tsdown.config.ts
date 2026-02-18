import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/exports/runtime.ts'],
  // Keep manual exports to preserve both "." and "./runtime" on the same artifact.
  exports: { enabled: false },
});
