import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/types': 'src/exports/types.ts',
    'exports/validators': 'src/exports/validators.ts',
    'exports/validate': 'src/exports/validate.ts',
    'exports/factories': 'src/exports/factories.ts',
    'exports/pack-types': 'src/exports/pack-types.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
});
