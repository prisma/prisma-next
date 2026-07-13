import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    pack: 'src/exports/pack.ts',
    contract: 'src/exports/contract.ts',
    adapter: 'src/exports/adapter.ts',
    runtime: 'src/exports/runtime.ts',
  },
  // Keep manual exports to preserve stable subpath mapping.
  exports: { enabled: false },
});
