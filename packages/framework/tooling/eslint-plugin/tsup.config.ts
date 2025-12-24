import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  minify: false,
  external: ['@typescript-eslint/types', '@typescript-eslint/utils', 'typescript', 'eslint'],
});
