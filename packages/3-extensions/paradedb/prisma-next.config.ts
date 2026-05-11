/**
 * Prisma Next config for the `extension-paradedb` package.
 *
 * The extension package is treated as a self-contained "project" for
 * the CLI: `prisma-next contract emit` writes
 * `<package>/src/contract/contract.{json,d.ts}` (colocated with the
 * TS source at `src/contract/contract-source.ts`); `prisma-next
 * migration plan` writes `<package>/migrations/paradedb/<dirName>/...`.
 * The descriptor at `src/exports/control.ts` then JSON-imports those
 * artefacts.
 *
 * This applies the on-disk-in-package authoring convention (see
 * `packages/3-extensions/test-contract-space/prisma-next.config.ts`
 * for the reference model).
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/control';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './src/contract/contract-source';
import { PARADEDB_SPACE_ID } from './src/core/constants';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  contract: typescriptContract(contract, 'src/contract/contract.json'),
  migrations: {
    dir: `migrations/${PARADEDB_SPACE_ID}`,
  },
});
