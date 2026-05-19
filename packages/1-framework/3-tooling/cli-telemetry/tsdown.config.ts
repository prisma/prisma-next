import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    'exports/index': 'src/exports/index.ts',
    sender: 'src/sender.ts',
  },
  exports: { enabled: false },
});
