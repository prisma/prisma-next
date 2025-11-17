import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    control: 'src/control.ts',
    context: 'src/exports/context.ts',
    runtime: 'src/exports/runtime.ts',
    types: 'src/exports/types.ts',
    'type-metadata': 'src/exports/type-metadata.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: false,
  target: 'es2022',
  minify: false,
});
