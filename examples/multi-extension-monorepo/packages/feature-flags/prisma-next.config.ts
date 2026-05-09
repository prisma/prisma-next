/**
 * Prisma Next config for the internal `feature-flags` contract-space
 * package — see `../audit/prisma-next.config.ts` for the framing.
 */

import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/control';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
import { FEATURE_FLAGS_SPACE_ID } from './constants';
import { contract } from './contract-source';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  contract: typescriptContract(contract, 'contract.json'),
  migrations: {
    dir: `migrations/${FEATURE_FLAGS_SPACE_ID}`,
  },
});
