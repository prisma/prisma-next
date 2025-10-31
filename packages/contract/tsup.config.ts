import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    types: 'src/exports/types.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});

