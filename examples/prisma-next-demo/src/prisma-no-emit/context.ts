import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { createExecutionStack } from '@prisma-next/core-execution-plane/stack';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { createExecutionContext } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';

// No-emit workflow: use the TypeScript contract directly.
import { contract } from '../../prisma/contract';

export const executionStack = createExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
});

export const executionContext = createExecutionContext({
  contract,
  stack: executionStack,
});

export const schema = schemaBuilder<typeof contract>(executionContext);
export const tables = schema.tables;

export const sql = sqlBuilder<typeof contract>({
  context: executionContext,
});

export const orm = ormBuilder<typeof contract>({
  context: executionContext,
});
