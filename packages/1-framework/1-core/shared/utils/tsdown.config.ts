import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/array-equal.ts',
    'src/exports/assertions.ts',
    'src/exports/defined.ts',
    'src/exports/result.ts',
    'src/exports/redact-db-url.ts',
  ],
});
