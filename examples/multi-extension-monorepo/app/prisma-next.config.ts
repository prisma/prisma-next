/**
 * Aggregate root config for the multi-extension-monorepo example.
 *
 * Composes the application's own contract with two internal extension
 * packages (`audit` and `feature-flags`). This is the config an
 * application author writes — the CLI reads it for `contract emit`,
 * `migration plan`, `db init`, and `db update`.
 */

import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import sql from '@prisma-next/family-sql/control';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
import audit from '../packages/audit/src/control';
import featureFlags from '../packages/feature-flags/src/control';
import { contract } from './src/contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  extensionPacks: [audit, featureFlags],
  contract: typescriptContract(contract, 'src/contract.json'),
  migrations: {
    dir: 'migrations',
  },
});
