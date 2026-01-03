import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
});
