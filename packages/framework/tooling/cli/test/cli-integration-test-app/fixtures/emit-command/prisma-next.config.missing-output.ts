import postgresAdapter from '@prisma-next/adapter-postgres/cli';
import type { AdapterDescriptor, TargetDescriptor } from '@prisma-next/core-control-plane/types';
import type { SqlFamilyContext } from '@prisma-next/family-sql/context';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/targets-postgres/cli';
import { contract } from './contract';

// Manually create config without using defineConfig to test error path
export default {
  family: sql,
  target: postgres as TargetDescriptor<SqlFamilyContext>,
  adapter: postgresAdapter as AdapterDescriptor<SqlFamilyContext>,
  extensions: [],
  contract: {
    source: contract,
    // Missing output and types to test error path
  },
};
