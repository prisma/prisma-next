import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    control: 'src/exports/control.ts',
    runtime: 'src/exports/runtime.ts',
    instance: 'src/exports/instance.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
