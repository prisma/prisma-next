import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/assembly.ts',
    'src/exports/types.ts',
    'src/exports/ir.ts',
    'src/exports/framework-components.ts',
    'src/exports/validate-domain.ts',
  ],
});
