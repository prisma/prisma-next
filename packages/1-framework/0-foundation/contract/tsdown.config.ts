import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/default-namespace.ts',
    'src/exports/resolve-domain-model.ts',
    'src/exports/types.ts',
    'src/exports/validate-domain.ts',
    'src/exports/contract-validation-error.ts',
    'src/exports/hashing.ts',
    'src/exports/hashing-utils.ts',
  ],
});
