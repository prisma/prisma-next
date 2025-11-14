import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'exports/schema': 'src/exports/schema.ts',
    'exports/param': 'src/exports/param.ts',
    'exports/types': 'src/exports/types.ts',
    'exports/operations-registry': 'src/exports/operations-registry.ts',
    'exports/errors': 'src/exports/errors.ts',
    'exports/ast': 'src/exports/ast.ts',
    'exports/plan': 'src/exports/plan.ts',
    'exports/query-lane-context': 'src/exports/query-lane-context.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
