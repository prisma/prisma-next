import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: [
    'src/exports/index.ts',
    'src/exports/parser.ts',
    'src/exports/tokenizer.ts',
    'src/exports/syntax.ts',
    'src/exports/types.ts',
  ],
});
