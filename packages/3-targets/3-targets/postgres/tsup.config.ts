import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/control': 'src/exports/control.ts',
    'exports/runtime': 'src/exports/runtime.ts',
    'exports/pack': 'src/exports/pack.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: false,
  target: 'es2022',
  minify: false,
});
