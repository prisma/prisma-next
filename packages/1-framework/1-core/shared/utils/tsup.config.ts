import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'exports/defined': 'src/exports/defined.ts',
    'exports/result': 'src/exports/result.ts',
  },
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
