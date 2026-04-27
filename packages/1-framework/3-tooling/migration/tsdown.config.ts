import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    'exports/metadata': 'src/exports/metadata.ts',
    'exports/package': 'src/exports/package.ts',
    'exports/graph': 'src/exports/graph.ts',
    'exports/errors': 'src/exports/errors.ts',
    'exports/io': 'src/exports/io.ts',
    'exports/hash': 'src/exports/hash.ts',
    'exports/dag': 'src/exports/dag.ts',
    'exports/refs': 'src/exports/refs.ts',
    'exports/constants': 'src/exports/constants.ts',
    'exports/migration-ts': 'src/exports/migration-ts.ts',
    'exports/migration': 'src/exports/migration.ts',
  },
  exports: { enabled: false },
});
