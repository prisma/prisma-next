import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';
import postgresPackRef from '@prisma-next/target-postgres/pack';
import { postgresCreateNamespace } from '@prisma-next/target-postgres/types';
import supabasePack from '../../src/exports/pack';

// The fixture app the hermetic integration tests exercise (Profile with a
// cross-space FK into auth.users and RLS policies) — the same contract shape
// examples/supabase ships. Emitted through the real pipeline via this
// package's `emit` script — never hand-edited.
export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [supabasePack],
  contract: prismaContract('./example-app/contract.prisma', {
    output: 'example-app/contract.json',
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
  }),
  migrations: {
    dir: 'migrations',
  },
});
