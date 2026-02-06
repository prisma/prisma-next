import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'exports/control': 'src/exports/control.ts',
    'exports/runtime': 'src/exports/runtime.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  sourcemap: true,
  dts: false,
  clean: true,
  target: 'es2022',
  minify: false,
  esbuildPlugins: [
    {
      // esbuild strips the `node:` prefix from builtin imports. For `node:sqlite` that
      // produces `sqlite`, which is not a valid builtin module specifier in Node.
      name: 'keep-node-sqlite',
      setup(build) {
        build.onResolve({ filter: /^sqlite$/ }, () => ({
          path: 'node:sqlite',
          external: true,
        }));
      },
    },
  ],
});
