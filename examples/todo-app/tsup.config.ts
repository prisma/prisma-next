import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/scripts/main.ts', 'src/scripts/setup-db.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'es2022',
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  bundle: true, // Bundle everything into one file
  external: [
    // Keep workspace packages external since they're already built
    '@prisma/cli',
    '@prisma/orm',
    '@prisma/psl',
    '@prisma/relational-ir',
    '@prisma/runtime',
    '@prisma/schema-emitter',
    '@prisma/sql',
  ],
});
