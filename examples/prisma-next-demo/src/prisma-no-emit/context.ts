import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { orm } from '@prisma-next/sql-orm-client';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import type { Runtime } from '@prisma-next/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import { contract } from '../../prisma/contract';
import { PostCollection, UserCollection } from '../orm-client/collections';

export const stack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [pgvector],
});

const validatedContract = validateContract<typeof contract>(contract);

export const context = createExecutionContext({
  contract: validatedContract,
  stack,
});

export const schema = schemaBuilder(context);
export const tables = schema.tables;
export const sql = sqlBuilder<typeof contract>({ context });

export function createOrmClient(runtime: Runtime) {
  return orm({
    runtime,
    context,
    collections: {
      User: UserCollection,
      Post: PostCollection,
    },
  });
}
