import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    types: 'src/exports/types.ts',
    executor: 'src/exports/executor.ts',
    'pack-manifest-types': 'src/pack-manifest-types.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
