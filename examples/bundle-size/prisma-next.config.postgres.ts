import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './src/postgres/contract.ts',
  outputPath: './src/postgres/generated',
});
