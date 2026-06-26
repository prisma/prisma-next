/**
 * Prisma Next config for the `extension-paradedb` package.
 *
 * The extension package is treated as a self-contained "project" for
 * the CLI: `prisma-next contract emit` writes
 * `<package>/src/contract.{json,d.ts}`; `prisma-next migration plan` writes
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
import { emptyContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  // migrations-only contract space: installs pg_search via migrations, contributes no app-visible schema
  contract: emptyContract({
    output: 'src/contract.json',
    target: postgres,
    createNamespace: postgresCreateNamespace,
  }),
  migrations: {
    dir: 'migrations',
  },
});
