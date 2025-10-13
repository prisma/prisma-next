import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/scripts/main.ts',
    'src/scripts/migrate.ts',
    'src/scripts/reset-db.ts',
    'src/scripts/verify-db.ts',
    'src/scripts/generate-migration.ts',
    'src/scripts/evolve-schema.ts',
    'src/scripts/demo.ts',
    'src/scripts/debug-migration.ts',
    'src/scripts/test-planner.ts',
  ],
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
    '@prisma/migrate',
    '@prisma/orm',
    '@prisma/psl',
    '@prisma/relational-ir',
    '@prisma/runtime',
    '@prisma/schema-emitter',
    '@prisma/sql',
  ],
});
