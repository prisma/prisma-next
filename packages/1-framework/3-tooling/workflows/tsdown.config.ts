import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/index.ts',
    'src/exports/compiler.ts',
    'src/exports/connectors.ts',
    'src/exports/connector-sdk.ts',
    'src/exports/runtime.ts',
    'src/exports/studio.ts',
    'src/exports/testing.ts',
  ],
});
