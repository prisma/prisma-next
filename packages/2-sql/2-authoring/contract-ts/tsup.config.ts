import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/contract-builder': 'src/exports/contract-builder.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
});
