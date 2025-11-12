import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/types': 'src/exports/types.ts',
    'exports/validators': 'src/exports/validators.ts',
    'exports/factories': 'src/exports/factories.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
