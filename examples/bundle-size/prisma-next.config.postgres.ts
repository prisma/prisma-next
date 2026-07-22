import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './src/postgres/contract.ts',
  output: './src/postgres/generated',
});
