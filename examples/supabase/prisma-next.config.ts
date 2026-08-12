import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import supabasePack from '@prisma-next/extension-supabase/pack';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import postgresPackRef from '@prisma-next/target-postgres/pack';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [supabasePack],
  contract: prismaContract('./src/contract.prisma', {
    output: 'src/contract.json',
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
  }),
  migrations: {
    dir: 'migrations',
  },
});
