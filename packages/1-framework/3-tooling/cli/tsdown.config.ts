import { baseConfig } from '@prisma-next/tsdown';
import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    ...baseConfig,
    banner: {
      js: '#!/usr/bin/env node',
    },
    entry: ['src/cli.ts'],
    outExtensions: () => ({
      js: '.js',
    }),
  },
  {
    ...baseConfig,
    entry: [
      'src/exports/index.ts',
      'src/exports/config-types.ts',
      'src/commands/db-init.ts',
      'src/commands/db-introspect.ts',
      'src/commands/db-schema-verify.ts',
      'src/commands/db-sign.ts',
      'src/commands/db-verify.ts',
      'src/commands/contract-emit.ts',
      'src/config-loader.ts',
      'src/exports/control-api.ts',
    ],
  },
]);
