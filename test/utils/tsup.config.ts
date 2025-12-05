import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'column-descriptors': 'src/column-descriptors.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
  external: ['@prisma/dev', 'pg', /^node:/],
  noExternal: [],
});
