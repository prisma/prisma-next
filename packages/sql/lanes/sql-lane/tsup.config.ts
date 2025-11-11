import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'exports/sql': 'src/exports/sql.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: {
    resolve: true,
  },
  clean: true,
  target: 'es2022',
  minify: false,
  tsconfig: './tsconfig.json',
});
