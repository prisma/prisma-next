/**
 * Prisma Next config for the `extension-paradedb` package.
 *
 * The extension package is treated as a self-contained "project" for
 * the CLI: `prisma-next contract emit` writes
 * `<package>/src/contract.{json,d.ts}` (colocated with the
 * `src/contract.prisma` source); `prisma-next migration plan` writes
 * `<package>/migrations/<dirName>/...`. The descriptor at
 * `src/exports/control.ts` then JSON-imports those artefacts.
 *
 * Follows the contract-space package layout convention.
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
  contract: prismaContract('./src/contract.prisma', {
    output: 'src/contract.json',
    target: postgres,
  }),
  migrations: {
    dir: 'migrations',
  },
});
