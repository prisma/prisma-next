import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    control: 'src/exports/control.ts',
    'control-adapter': 'src/core/control-adapter.ts',
    runtime: 'src/exports/runtime.ts',
    verify: 'src/exports/verify.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
