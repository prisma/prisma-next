import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    index: 'src/exports/index.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
});

