import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/components.ts',
    'src/exports/authoring.ts',
    'src/exports/control.ts',
    'src/exports/execution.ts',
  ],
});
