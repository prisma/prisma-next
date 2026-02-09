import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvectorDescriptor from '@prisma-next/extension-pgvector/runtime';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const contract = validateContract<Contract>(contractJson);

export const executionStack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [pgvectorDescriptor],
});

export const executionContext = createExecutionContext({
  contract,
  stack: executionStack,
});

export const schema = schemaBuilder(executionContext);
export const tables = schema.tables;
export const sql = sqlBuilder({ context: executionContext });
export const orm = ormBuilder({ context: executionContext });
