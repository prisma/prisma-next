import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    runtime: 'src/runtime.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
});
