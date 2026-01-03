import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    control: 'src/exports/control.ts',
    runtime: 'src/exports/runtime.ts',
    pack: 'src/exports/pack.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: false,
  target: 'es2022',
  minify: false,
});
