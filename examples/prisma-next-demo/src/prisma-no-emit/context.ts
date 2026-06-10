import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import pgvector from '@prisma-next/extension-pgvector/runtime';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import { orm } from '@prisma-next/sql-orm-client';
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

// The no-emit path passes the TS-authored contract directly; the
// deserializer's method-level type parameter recovers the literal-
// typed contract shape (from the generated `contract.d.ts`) so
// downstream DSL calls keep their precise types.
const validatedContract = new SqlContractSerializer().deserializeContract<typeof contract>(
  contract,
);

export const context = createExecutionContext({
  contract: validatedContract,
  stack,
});

export const sql = sqlBuilder<typeof contract>({
  context,
  rawCodecInferer: { inferCodec: () => 'pg/text' },
}).public;

export function createOrmClient(runtime: Runtime) {
  // The no-emit contract types its domain namespaces loosely, so narrow the
  // `public` facet with a runtime guard rather than a cast. Enums now live on
  // the facet under the reserved `enums` key (`facet.enums.Priority`).
  const client = orm({
    runtime,
    context,
    collections: {
      User: UserCollection,
      Post: PostCollection,
    },
  });
  const publicNs = client['public'];
  if (publicNs === undefined) {
    throw new Error("ORM client is missing the 'public' namespace");
  }
  return publicNs;
}
