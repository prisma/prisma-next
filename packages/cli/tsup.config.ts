import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  external: ['commander'],
  // Bundle all workspace dependencies
  noExternal: ['@prisma/psl', '@prisma/schema-emitter', '@prisma/relational-ir'],
});
