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
      'pack-manifest-types': 'src/exports/pack-manifest-types.ts',
      'pack-assembly': 'src/exports/pack-assembly.ts',
      'pack-loading': 'src/pack-loading.ts',
      'utils/marker-parser': 'src/utils/marker-parser.ts',
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
