import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      cli: 'src/cli.ts',
    },
    outDir: 'dist',
    format: ['esm'],
    sourcemap: true,
    clean: false,
    target: 'es2022',
    minify: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
  {
    entry: {
      index: 'src/exports/index.ts',
      'config-types': 'src/exports/config-types.ts',
    },
    outDir: 'dist',
    format: ['esm'],
    sourcemap: true,
    dts: true,
    clean: false,
    target: 'es2022',
    minify: false,
  },
]);
