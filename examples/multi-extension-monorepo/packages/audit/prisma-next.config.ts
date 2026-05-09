/**
 * Prisma Next config for the internal `audit` contract-space package.
 *
 * Each "internal package" subdirectory is treated as a self-contained
 * "project" for the CLI: `prisma-next contract emit` writes
 * `<package>/contract.{json,d.ts}`; `prisma-next migration plan`
 * writes `<package>/migrations/audit/<dirName>/...`. The descriptor at
 * `./control.ts` then JSON-imports those artefacts.
 *
 * This is the M3.5 R3 application of the on-disk-in-package authoring
 * convention introduced in M3.5 R1 (see `packages/3-extensions/
 * test-contract-space/prisma-next.config.ts` for the reference model).
 *
 * @see docs/architecture docs/adrs/ADR 211 - Contract spaces.md
 */

import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/control';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
import { AUDIT_SPACE_ID } from './constants';
import { contract } from './contract-source';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  contract: typescriptContract(contract, 'contract.json'),
  migrations: {
    dir: `migrations/${AUDIT_SPACE_ID}`,
  },
});
