/**
 * Prisma Next config for the internal `feature-flags` contract-space
 * package — see `../audit/prisma-next.config.ts` for the framing.
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
