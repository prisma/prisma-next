import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/exports/index.ts'],
  format: ['esm'],
  dts: {
    compilerOptions: {
      composite: false,
    },
  },
  clean: true,
  sourcemap: true,
  external: ['@prisma/*', 'pg'], // Don't bundle workspace deps or pg
});
