import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'column-descriptors': 'src/column-descriptors.ts',
    'operation-descriptors': 'src/operation-descriptors.ts',
    timeouts: 'src/timeouts.ts',
    'typed-expectations': 'src/typed-expectations.ts',
  },
  external: ['@prisma/dev', 'pg', 'vitest', /^node:/],
  outDir: 'dist/exports',
  // Keep manual exports to preserve root "." mapping with this custom outDir layout.
  exports: { enabled: false },
  dts: { enabled: true, sourcemap: true },
  sourcemap: true,
});
