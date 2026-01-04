import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/control': 'src/exports/control.ts',
    'exports/control-adapter': 'src/exports/control-adapter.ts',
    'exports/runtime': 'src/exports/runtime.ts',
    'exports/verify': 'src/exports/verify.ts',
    'exports/test-utils': 'src/exports/test-utils.ts',
    'exports/schema-verify': 'src/exports/schema-verify.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
});
