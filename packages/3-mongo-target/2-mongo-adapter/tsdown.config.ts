import { defineConfig } from '@prisma-next/tsdown';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    codecs: 'src/exports/codecs.ts',
    'codec-types': 'src/exports/codec-types.ts',
    control: 'src/exports/control.ts',
  },
});
