import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/config.ts',
    'src/exports/contract-builder.ts',
    'src/exports/pack.ts',
    'src/exports/runtime.ts',
    'src/exports/serverless.ts',
    'src/exports/target.ts',
  ],
});
