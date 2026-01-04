import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/config-types': 'src/exports/config-types.ts',
    'exports/config-validation': 'src/exports/config-validation.ts',
    'exports/errors': 'src/exports/errors.ts',
    'exports/types': 'src/exports/types.ts',
    'exports/stack': 'src/exports/stack.ts',
    'exports/emission': 'src/exports/emission.ts',
    'exports/schema-view': 'src/exports/schema-view.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
});
