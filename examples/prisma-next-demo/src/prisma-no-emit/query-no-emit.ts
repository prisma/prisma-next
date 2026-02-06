import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import {
  createExecutionStack,
  instantiateExecutionStack,
} from '@prisma-next/core-execution-plane/stack';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { createExecutionContext } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
// Use contract directly from TypeScript - no emit needed!
import { contract } from '../../prisma/contract';

export const executionStack = createExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
});

export const executionStackInstance = instantiateExecutionStack(executionStack);
export const executionContext = createExecutionContext({
  contract,
  stack: executionStack,
});

export const sql = sqlBuilder<typeof contract>({
  context: executionContext,
});

export const schema = schemaBuilder<typeof contract>(executionContext);
export const tables = schema.tables;

export const orm = ormBuilder<typeof contract>({
  context: executionContext,
});
