import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/adapter': 'src/exports/adapter.ts',
    'exports/types': 'src/exports/types.ts',
    'exports/codec-types': 'src/exports/codec-types.ts',
    'exports/column-types': 'src/exports/column-types.ts',
    'exports/control': 'src/exports/control.ts',
    'exports/runtime': 'src/exports/runtime.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
});
