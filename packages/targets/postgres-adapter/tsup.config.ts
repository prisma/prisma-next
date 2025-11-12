import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    adapter: 'src/exports/adapter.ts',
    types: 'src/exports/types.ts',
    'codec-types': 'src/exports/codec-types.ts',
    cli: 'src/exports/cli.ts',
    runtime: 'src/exports/runtime.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
