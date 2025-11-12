import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/exports/cli.ts',
    runtime: 'src/exports/runtime.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
