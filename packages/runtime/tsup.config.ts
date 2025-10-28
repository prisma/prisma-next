import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/exports/index.ts'],
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
