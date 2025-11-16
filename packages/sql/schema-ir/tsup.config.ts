import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/types': 'src/exports/types.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});

