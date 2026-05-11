/**
 * Prisma Next config for the `extension-cipherstash` package.
 *
 * The extension package is treated as a self-contained "project" for
 * the CLI: `prisma-next contract emit` writes
 * `<package>/src/contract/contract.{json,d.ts}` (colocated with the
 * `contract.prisma` source); `prisma-next migration plan` writes
 * `<package>/migrations/cipherstash/<dirName>/...`. The descriptor at
 * `src/exports/control.ts` then JSON-imports those artefacts.
 *
 * This package follows the on-disk-in-package authoring convention (see
 * `packages/3-extensions/test-contract-space/prisma-next.config.ts` for the reference model).
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 */

import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import { CIPHERSTASH_SPACE_ID } from './src/extension-metadata/constants';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  contract: prismaContract('./src/contract/contract.prisma', {
    output: 'src/contract/contract.json',
    target: postgres,
  }),
  migrations: {
    dir: `migrations/${CIPHERSTASH_SPACE_ID}`,
  },
});
