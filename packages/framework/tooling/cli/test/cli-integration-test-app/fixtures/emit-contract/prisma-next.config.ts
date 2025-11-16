import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import { defineConfig } from '@prisma-next/cli/config-types';
import type { AdapterDescriptor, TargetDescriptor } from '@prisma-next/core-control-plane/types';
import type { SqlFamilyContext } from '@prisma-next/family-sql/context';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/targets-postgres/cli';
import { contract } from './contract';

export default defineConfig<SqlFamilyContext>({
  family: sql,
  target: postgres as TargetDescriptor<SqlFamilyContext>,
  adapter: postgresAdapter as AdapterDescriptor<SqlFamilyContext>,
  extensions: [],
  contract: {
    source: contract,
    output: 'output/contract.json',
    types: 'output/contract.d.ts',
  },
});
