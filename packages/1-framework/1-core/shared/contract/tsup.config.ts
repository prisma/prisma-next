import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/types': 'src/exports/types.ts',
    'exports/pack-manifest-types': 'src/exports/pack-manifest-types.ts',
    'exports/ir': 'src/exports/ir.ts',
    'exports/framework-components': 'src/exports/framework-components.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
});
