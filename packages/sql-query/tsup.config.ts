import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    sql: 'src/exports/sql.ts',
    orm: 'src/exports/orm.ts',
    schema: 'src/exports/schema.ts',
    param: 'src/exports/param.ts',
    types: 'src/exports/types.ts',
    errors: 'src/exports/errors.ts',
    'contract-builder': 'src/exports/contract-builder.ts',
  },
  outDir: 'dist/exports',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
