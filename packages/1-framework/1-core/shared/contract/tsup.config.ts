import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    types: 'src/exports/types.ts',
    'pack-manifest-types': 'src/exports/pack-manifest-types.ts',
    ir: 'src/exports/ir.ts',
    'framework-components': 'src/exports/framework-components.ts',
    'pack-ref-types': 'src/exports/pack-ref-types.ts',
    'descriptor-manifest': 'src/exports/descriptor-manifest.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
