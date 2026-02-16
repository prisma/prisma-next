import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/exports/contract-builder.ts'],
  exports: { enabled: false },
});
