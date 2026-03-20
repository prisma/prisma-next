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

export function createPostsCollection(runtime: PgIntegrationRuntime) {
  return new Collection({ runtime, context: getTestContext() }, 'Post');
}

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
