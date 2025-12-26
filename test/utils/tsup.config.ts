import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'column-descriptors': 'src/column-descriptors.ts',
    'operation-descriptors': 'src/operation-descriptors.ts',
    timeouts: 'src/timeouts.ts',
    'typed-expectations': 'src/typed-expectations.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
  external: ['@prisma/dev', 'pg', 'vitest', /^node:/],
  noExternal: [],
});
