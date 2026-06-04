import { defineConfig } from '@prisma-next/postgres/config';

export default defineConfig({
  contract: './schema.prisma',
  outputPath: 'generated',
});
