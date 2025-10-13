import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/exports/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@prisma/relational-ir', '@prisma/sql'],
});
