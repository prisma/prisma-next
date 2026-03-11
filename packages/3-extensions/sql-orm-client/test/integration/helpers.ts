import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { Collection } from '../../src/collection';
import { withReturningCapability } from '../collection-fixtures';
import { getTestContract } from '../helpers';
import {
  createPgIntegrationRuntime,
  type PgIntegrationRuntime,
  setupTestSchema,
} from './runtime-helpers';

export { timeouts };

export function createUsersCollection(runtime: PgIntegrationRuntime) {
  const contract = getTestContract();
  return new Collection({ contract, runtime }, 'User');
}

export function createPostsCollection(runtime: PgIntegrationRuntime) {
  const contract = getTestContract();
  return new Collection({ contract, runtime }, 'Post');
}

export function createReturningUsersCollection(runtime: PgIntegrationRuntime) {
  const contract = withReturningCapability(getTestContract());
  return new Collection({ contract, runtime }, 'User');
}

export function createReturningPostsCollection(runtime: PgIntegrationRuntime) {
  const contract = withReturningCapability(getTestContract());
  return new Collection({ contract, runtime }, 'Post');
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
