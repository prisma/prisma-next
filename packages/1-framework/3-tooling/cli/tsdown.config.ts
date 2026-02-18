import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    '.': 'src/exports/index.ts',
    'config-types': 'src/exports/config-types.ts',
    'commands/db-init': 'src/commands/db-init.ts',
    'commands/db-introspect': 'src/commands/db-introspect.ts',
    'commands/db-schema-verify': 'src/commands/db-schema-verify.ts',
    'commands/db-sign': 'src/commands/db-sign.ts',
    'commands/db-verify': 'src/commands/db-verify.ts',
    'commands/contract-emit': 'src/commands/contract-emit.ts',
    'config-loader': 'src/config-loader.ts',
    'control-api': 'src/exports/control-api.ts',
  },
  outputOptions: (opts) => ({
    ...opts,
    banner: (chunk) => (chunk.name === 'cli' ? '#!/usr/bin/env node\n' : ''),
  }),
});
