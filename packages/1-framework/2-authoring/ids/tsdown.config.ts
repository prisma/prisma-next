import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/runtime.ts'],
});
