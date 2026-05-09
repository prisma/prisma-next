/**
 * Prisma Next config for the synthetic `test-contract-space` extension.
 *
 * The extension package is treated as a self-contained "project" for
 * the CLI: `prisma-next contract emit` writes
 * `<package>/contract.{json,d.ts}`; `prisma-next migration plan` writes
 * `<package>/migrations/test-contract-space/<dirName>/...`. The
 * descriptor at `src/exports/control.ts` then JSON-imports those
 * artefacts.
 *
 * This package is the reference model for that convention — see ADR 211 (Contract spaces)
 * for the full authoring story; cipherstash and pgvector adopt the same shape with their own migrations.
 */

import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/control';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './src/contract-source';
import { TEST_SPACE_ID } from './src/core/constants';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  contract: typescriptContract(contract, 'contract.json'),
  migrations: {
    dir: `migrations/${TEST_SPACE_ID}`,
  },
});
