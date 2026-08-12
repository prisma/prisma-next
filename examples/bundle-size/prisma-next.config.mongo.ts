import { defineConfig } from '@prisma-next/mongo/config';

export default defineConfig({
  contract: './src/mongo/contract.ts',
  output: './src/mongo/generated',
});
