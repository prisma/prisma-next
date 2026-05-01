import 'dotenv/config';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
// `./prisma/contract` is statically imported so its TypeScript source becomes
// part of this config's module graph, which is what the Vite plugin watches
// to trigger re-emits on `prisma/contract.ts` edits. ESM evaluates this import
// even when `useTs` is false, but the cost is tiny: `prisma/contract.ts` only
// calls `defineContract` (a pure builder, no I/O, no side effects). Two
// alternatives were considered and rejected: `typescriptContractFromPath`
// (would make the file an explicit `source.input` but adds surface for an
// example that's deliberately minimal — see the m1 review's D05) and
// splitting into two config files (the older sibling-config pattern this
// example specifically replaces with a single env-gated config).
import { contract } from './prisma/contract';

const useTs = process.env['PRISMA_NEXT_CONTRACT_SOURCE'] === 'ts';

// Note: `extensionPacks` is optional and intentionally omitted. The schema
// property is `extensionPacks` (not `extensions` — `validateConfig` rejects
// the latter); `examples/prisma-next-demo` declares it only because it
// registers pgvector. This example has no extensions yet.
export default defineConfig({
  family: sql,
  target: postgres,
  driver: postgresDriver,
  adapter: postgresAdapter,
  contract: useTs
    ? typescriptContract(contract, 'src/prisma/contract.json')
    : prismaContract('./prisma/contract.prisma', {
        output: 'src/prisma/contract.json',
        target: postgres,
      }),
  db: {
    // Left undefined when DATABASE_URL is not set so emit-only flows
    // (`prisma-next contract emit`, CI typegen) work in fresh checkouts.
    // Commands that need a connection surface their own error pointing at
    // `db.connection` or `--db <url>`.
    connection: process.env['DATABASE_URL'],
  },
});
