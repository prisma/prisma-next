import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
// No-emit workflow: use the TypeScript contract directly.
import { contract } from '../../prisma/contract';

// pgvector was previously missing here; added for parity with the emit workflow config.
export const stack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [pgvector],
});

export const context = createExecutionContext({
  contract,
  stack,
});

export const schema = schemaBuilder(context);
export const tables = schema.tables;
export const sql = sqlBuilder({ context });
