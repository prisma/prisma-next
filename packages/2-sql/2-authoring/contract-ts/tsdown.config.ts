import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/exports/contract-builder.ts'],
  // This package intentionally keeps manual exports to preserve the JSON schema subpath export.
  exports: { enabled: false },
});
