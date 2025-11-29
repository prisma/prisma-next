import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    executor: 'src/executor.ts',
    'execute-migration': 'src/execute-migration.ts',
    ir: 'src/ir.ts',
    errors: 'src/errors.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2022',
  minify: false,
});
