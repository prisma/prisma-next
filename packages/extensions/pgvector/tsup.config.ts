import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    control: 'src/exports/control.ts',
    runtime: 'src/exports/runtime.ts',
    'codec-types': 'src/exports/codec-types.ts',
    'column-types': 'src/exports/column-types.ts',
    'operation-types': 'src/exports/operation-types.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
