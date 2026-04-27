import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import sqliteDriver from '@prisma-next/driver-sqlite/runtime';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { orm } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import sqliteTarget from '@prisma-next/target-sqlite/runtime';
import { contract } from '../../prisma/contract';
import { PostCollection, UserCollection } from '../orm-client/collections';

export const stack = createSqlExecutionStack({
  target: sqliteTarget,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
  extensionPacks: [],
});

const validatedContract = validateContract<typeof contract>(contract, emptyCodecLookup);

export const context = createExecutionContext({
  contract: validatedContract,
  stack,
});

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
