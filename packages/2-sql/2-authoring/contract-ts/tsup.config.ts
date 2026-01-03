import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'contract-builder': 'src/exports/contract-builder.ts',
    contract: 'src/exports/contract.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
});
