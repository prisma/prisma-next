/**
 * Prisma Next config for the `extension-better-auth` package.
 *
 * The extension package is treated as a self-contained "project" for
 * the CLI: `prisma-next contract emit` writes
 * `<package>/src/contract/contract.{json,d.ts}` (colocated with the
 * PSL source); `prisma-next migration plan` writes
 * `<package>/migrations/<dirName>/...`. The pack descriptor at
 * `src/pack/index.ts` then JSON-imports those artefacts.
 *
 * The contract space is **managed** (the contract default — no
 * `defaultControlPolicy` override): the framework owns the auth
 * tables' DDL lifecycle via the space's shipped migrations.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  contract: prismaContract('src/contract/contract.prisma', {
    target: postgres,
  }),
  migrations: {
    dir: 'migrations',
  },
});
