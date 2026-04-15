import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    'exports/execution': 'src/exports/execution.ts',
    'exports/control': 'src/exports/control.ts',
    'exports/internal': 'src/exports/internal.ts',
  },
  exports: { enabled: false },
});
