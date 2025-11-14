import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/config-types': 'src/exports/config-types.ts',
    'exports/config-validation': 'src/exports/config-validation.ts',
    'exports/emit-contract': 'src/exports/emit-contract.ts',
    'exports/verify-database': 'src/exports/verify-database.ts',
    'exports/errors': 'src/exports/errors.ts',
    'exports/pack-manifest-types': 'src/exports/pack-manifest-types.ts',
    'exports/marker-parser': 'src/exports/marker-parser.ts',
    'exports/types': 'src/exports/types.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
