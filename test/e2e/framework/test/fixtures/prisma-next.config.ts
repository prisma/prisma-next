import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import type { Contract } from '@prisma-next/contract/types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import { typescriptContract } from '@prisma-next/sql-contract-ts/config-types';
import postgres from '@prisma-next/target-postgres/control';
import { contract } from './contract';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
  // TML-2191 will align SqlContract.execution with ContractExecutionSection;
  // until then the builder's return type and Contract diverge on execution shape.
  contract: typescriptContract(
    contract as unknown as Contract,
    'test/fixtures/generated/contract.json',
  ),
});
