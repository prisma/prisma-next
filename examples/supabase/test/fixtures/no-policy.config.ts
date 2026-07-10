import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import supabasePack from '@prisma-next/extension-supabase/pack';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import postgresPackRef from '@prisma-next/target-postgres/pack';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';

// Variant contract state for the skeleton e2e (no-policy). Emitted through the
// real pipeline via this example's `emit` script — never hand-edited.
export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [supabasePack],
  contract: prismaContract('./no-policy/contract.prisma', {
    output: 'no-policy/contract.json',
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
  }),
  migrations: {
    dir: 'migrations',
  },
});
