import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'canonicalization-hooks': 'src/exports/canonicalization-hooks.ts',
    'entry-construction-registry': 'src/exports/entry-construction-registry.ts',
  },
});
