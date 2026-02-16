import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/cli.ts',
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
  exports: { enabled: false },
  outputOptions: (opts) => ({
    ...opts,
    banner: (chunk) => (chunk.name === 'cli' ? '#!/usr/bin/env node\n' : ''),
  }),
});
