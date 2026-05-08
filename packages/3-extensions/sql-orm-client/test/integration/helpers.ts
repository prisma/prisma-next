import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { Collection } from '../../src/collection';
import { withReturningCapability } from '../collection-fixtures';
import { getTestContext, getTestContract, type TestContract } from '../helpers';
import {
  createPgIntegrationRuntime,
  type PgIntegrationRuntime,
  setupTestSchema,
} from './runtime-helpers';

export { timeouts };

export function createUsersCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: getTestContext() }, 'User');
}

export function createUsersCollectionWithoutReturning(runtime: PgIntegrationRuntime) {
  const contract = { ...getTestContract(), capabilities: {} } as TestContract;
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'User');
}

export function createPostsCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: getTestContext() }, 'Post');
}

// Shallow spread is intentional — withReturningCapability only adds capabilities
// without changing codec structure, so codecs/operations registries remain valid.
export function createReturningUsersCollection(runtime: PgIntegrationRuntime) {
  const contract = withReturningCapability(getTestContract());
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'User');
}

export function createReturningPostsCollection(runtime: PgIntegrationRuntime) {
  const contract = withReturningCapability(getTestContract());
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'Post');
}

export function createReturningTagsCollection(runtime: PgIntegrationRuntime) {
  const contract = withReturningCapability(getTestContract());
  const context = { ...getTestContext(), contract } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'Tag');
}

// Tags collection bound to a contract where `tags.primaryKey` has been
// stripped, simulating an id-less SQL model. The underlying Postgres table
// still has a primary key (we don't reshape the schema here); the contract is
// the orm-client's source of truth for PK presence, so the lane behaves as
// though the table had none. Use this for id-less ORM end-to-end coverage.
export function createIdlessTagsCollection(runtime: PgIntegrationRuntime) {
  const base = withReturningCapability(getTestContract());
  const tagsTable = base.storage.tables.tags;
  const idlessContract = {
    ...base,
    storage: {
      ...base.storage,
      tables: {
        ...base.storage.tables,
        tags: { ...tagsTable, primaryKey: undefined },
      },
    },
    // Cast through `unknown` because TestContract pins `tags.primaryKey` to
    // the literal shape generated for the fixture; widening it to undefined
    // is intentional for this id-less test scenario.
  } as unknown as TestContract;
  const context = {
    ...getTestContext(),
    contract: idlessContract,
  } as ExecutionContext<TestContract>;
  return new Collection({ runtime, context }, 'Tag');
}

export async function withCollectionRuntime(
  fn: (runtime: PgIntegrationRuntime) => Promise<void>,
): Promise<void> {
  await withDevDatabase(async ({ connectionString }) => {
    const runtime = await createPgIntegrationRuntime(connectionString);

    try {
      await setupTestSchema(runtime);
      await fn(runtime);
    } finally {
      await runtime.close();
    }
  });
}
