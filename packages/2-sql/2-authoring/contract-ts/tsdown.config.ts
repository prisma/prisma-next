import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/exports/contract-builder.ts', 'src/exports/contract.ts'],
});
