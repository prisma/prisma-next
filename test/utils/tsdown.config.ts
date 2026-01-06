import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    './src/exports/index.ts',
    './src/column-descriptors.ts',
    './src/operation-descriptors.ts',
    './src/timeouts.ts',
    './src/typed-expectations.ts',
  ],
});
