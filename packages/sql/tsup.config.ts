import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    sql: 'src/sql.ts',
    schema: 'src/schema.ts',
    param: 'src/param.ts',
    types: 'src/types.ts',
    errors: 'src/errors.ts',
  },
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
