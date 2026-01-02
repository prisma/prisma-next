import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/defined': 'src/exports/defined.ts',
    'exports/result': 'src/exports/result.ts',
    'exports/redact-db-url': 'src/exports/redact-db-url.ts',
  },
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
