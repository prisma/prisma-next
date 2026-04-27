import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    'exports/types': 'src/exports/types.ts',
    'exports/io': 'src/exports/io.ts',
    'exports/attestation': 'src/exports/attestation.ts',
    'exports/graph': 'src/exports/graph.ts',
    'exports/refs': 'src/exports/refs.ts',
    'exports/constants': 'src/exports/constants.ts',
    'exports/migration-ts': 'src/exports/migration-ts.ts',
    'exports/migration': 'src/exports/migration.ts',
  },
  exports: { enabled: false },
});
