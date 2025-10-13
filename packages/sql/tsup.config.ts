import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/builder.ts', 'src/exports/index.ts'],
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
