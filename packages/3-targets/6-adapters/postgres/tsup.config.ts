import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    adapter: 'src/exports/adapter.ts',
    types: 'src/exports/types.ts',
    'codec-types': 'src/exports/codec-types.ts',
    'column-types': 'src/exports/column-types.ts',
    control: 'src/exports/control.ts',
    runtime: 'src/exports/runtime.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
});
