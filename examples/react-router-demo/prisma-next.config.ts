import 'dotenv/config';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './prisma/contract';

const useTs = process.env['PRISMA_NEXT_CONTRACT_SOURCE'] === 'ts';
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and fill in a Postgres connection string.',
  );
}

export default defineConfig({
  family: sql,
  target: postgres,
  driver: postgresDriver,
  adapter: postgresAdapter,
  contract: useTs
    ? typescriptContract(contract, 'src/prisma/contract.json')
    : prismaContract('./prisma/schema.prisma', {
        output: 'src/prisma/contract.json',
        target: postgres,
      }),
  db: {
    connection: databaseUrl,
  },
});
