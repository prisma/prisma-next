import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    adapter: 'src/adapter.ts',
    types: 'src/types.ts',
  },
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
