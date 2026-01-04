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
      'exports/index': 'src/exports/index.ts',
      'exports/config-types': 'src/exports/config-types.ts',
      'commands/db-init': 'src/commands/db-init.ts',
      'commands/db-introspect': 'src/commands/db-introspect.ts',
      'commands/db-schema-verify': 'src/commands/db-schema-verify.ts',
      'commands/db-sign': 'src/commands/db-sign.ts',
      'commands/db-verify': 'src/commands/db-verify.ts',
      'commands/contract-emit': 'src/commands/contract-emit.ts',
      'config-loader': 'src/config-loader.ts',
    },
    outDir: 'dist',
    format: ['esm'],
    sourcemap: true,
    dts: false,
    clean: false,
    target: 'es2022',
    minify: false,
  },
]);
