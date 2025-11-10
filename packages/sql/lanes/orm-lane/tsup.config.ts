import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/orm': 'src/exports/orm.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
