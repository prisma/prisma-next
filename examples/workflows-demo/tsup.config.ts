import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/prisma/scripts/stamp-marker.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
