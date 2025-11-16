import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    control: 'src/exports/control.ts',
    context: 'src/exports/context.ts',
    runtime: 'src/exports/runtime.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: false,
  target: 'es2022',
  minify: false,
});
