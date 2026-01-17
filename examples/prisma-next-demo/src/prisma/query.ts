import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvectorDescriptor from '@prisma-next/extension-pgvector/runtime';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { createExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const contract = validateContract<Contract>(contractJson);

export const executionStack = createExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [pgvectorDescriptor],
});

export const executionContext = executionStack.createContext({ contract });

export const sql = sqlBuilder<Contract>({
  context: executionContext,
});

export const schema = schemaBuilder<Contract>(executionContext);
export const tables = schema.tables;

export const orm = ormBuilder<Contract>({
  context: executionContext,
});
