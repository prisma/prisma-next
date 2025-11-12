import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
