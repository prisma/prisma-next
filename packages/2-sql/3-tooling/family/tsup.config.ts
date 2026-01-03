import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    control: 'src/exports/control.ts',
    'control-adapter': 'src/exports/control-adapter.ts',
    runtime: 'src/exports/runtime.ts',
    verify: 'src/exports/verify.ts',
    'test-utils': 'src/exports/test-utils.ts',
    'schema-verify': 'src/exports/schema-verify.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
});
