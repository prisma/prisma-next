import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      'exports/index': 'src/exports/index.ts',
    },
    outDir: 'dist',
    format: ['esm'],
    sourcemap: true,
    dts: false,
    clean: false,
    target: 'es2022',
    minify: false,
  },
]);
