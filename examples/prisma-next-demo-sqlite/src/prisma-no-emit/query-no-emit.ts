import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import {
  createExecutionStack,
  instantiateExecutionStack,
} from '@prisma-next/core-execution-plane/stack';
import sqliteDriver from '@prisma-next/driver-sqlite/runtime';
import sqlitevectorDescriptor from '@prisma-next/extension-sqlite-vector/runtime';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { createExecutionContext } from '@prisma-next/sql-runtime';
import sqliteTarget from '@prisma-next/target-sqlite/runtime';
// Use contract directly from TypeScript - no emit needed!
import { contract } from '../../prisma/contract';

export const executionStack = createExecutionStack({
  target: sqliteTarget,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
  extensionPacks: [sqlitevectorDescriptor],
});

export const executionStackInstance = instantiateExecutionStack(executionStack);
export const executionContext = createExecutionContext({
  contract,
  stackInstance: executionStackInstance,
});

export const sql = sqlBuilder<typeof contract>({
  context: executionContext,
});

export const schema = schemaBuilder<typeof contract>(executionContext);
export const tables = schema.tables;

export const orm = ormBuilder<typeof contract>({
  context: executionContext,
});
