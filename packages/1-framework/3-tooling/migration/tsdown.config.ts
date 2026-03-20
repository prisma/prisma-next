import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    'exports/types': 'src/exports/types.ts',
    'exports/io': 'src/exports/io.ts',
    'exports/attestation': 'src/exports/attestation.ts',
    'exports/dag': 'src/exports/dag.ts',
    'exports/refs': 'src/exports/refs.ts',
  },
  exports: { enabled: false },
});
