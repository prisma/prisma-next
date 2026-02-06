import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
// No-emit workflow: use the TypeScript contract directly.
import { contract } from '../../prisma/contract';

export const executionStack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [],
});

export const context = createExecutionContext({
  contract,
  stack: executionStack,
});

export const schema = schemaBuilder<typeof contract>(context);
export const tables = schema.tables;
export const sql = sqlBuilder<typeof contract>({ context });
export const orm = ormBuilder<typeof contract>({ context });
