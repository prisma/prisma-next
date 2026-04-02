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
// TODO: this import defeats the purpose of the no-emit flow. The staged DSL's
// inferred type (SqlContractResult<Definition>) is too deeply nested for
// TypeScript to reduce to literal table/field keys. Fixing this is a failing
// acceptance criterion for the ts-contract-authoring-redesign project.
import type { Contract } from '../prisma/contract.d';

export const stack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [pgvector],
});

const validatedContract = validateContract<Contract>(contract);

export const context = createExecutionContext({
  contract: validatedContract,
  stack,
});

export const schema = schemaBuilder(context);
export const tables = schema.tables;
export const sql = sqlBuilder<Contract>({ context });

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
