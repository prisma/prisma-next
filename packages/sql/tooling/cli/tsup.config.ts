import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/exports/cli.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: false,
  target: 'es2022',
  minify: false,
});
