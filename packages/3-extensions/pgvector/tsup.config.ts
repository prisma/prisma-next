import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/control': 'src/exports/control.ts',
    'exports/runtime': 'src/exports/runtime.ts',
    'exports/codec-types': 'src/exports/codec-types.ts',
    'exports/column-types': 'src/exports/column-types.ts',
    'exports/operation-types': 'src/exports/operation-types.ts',
    'exports/pack': 'src/exports/pack.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
});
