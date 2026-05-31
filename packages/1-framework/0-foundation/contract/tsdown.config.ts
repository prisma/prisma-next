import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/types.ts',
    'src/exports/validate-domain.ts',
    'src/exports/contract-validation-error.ts',
    'src/exports/hashing.ts',
    'src/exports/hashing-utils.ts',
  ],
});
