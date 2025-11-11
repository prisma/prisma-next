import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/index': 'src/exports/index.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: false,
  target: 'es2022',
  minify: false,
});
