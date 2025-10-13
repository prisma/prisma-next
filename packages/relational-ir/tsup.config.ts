import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/exports/index.ts', 'src/exports/schema.ts'],
  format: ['esm'],
  dts: {
    compilerOptions: {
      composite: false,
    },
  },
  clean: true,
  sourcemap: true,
  external: ['@prisma/*'], // Don't bundle workspace deps
});
