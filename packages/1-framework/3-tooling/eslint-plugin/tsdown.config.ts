import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  external: ['@typescript-eslint/types', '@typescript-eslint/utils', 'typescript', 'eslint'],
});
