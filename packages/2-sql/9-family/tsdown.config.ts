import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/control.ts',
    'src/exports/control-adapter.ts',
    'src/exports/ir.ts',
    'src/exports/migration.ts',
    'src/exports/pack.ts',
    'src/exports/runtime.ts',
    'src/exports/verify.ts',
    'src/exports/ledger-read.ts',
    'src/exports/test-utils.ts',
    'src/exports/schema-verify.ts',
  ],
});
