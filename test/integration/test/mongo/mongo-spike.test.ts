import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { applyMigration } from '@prisma-next/test-utils/migration-harness';
import { timeouts } from '@prisma-next/test-utils/timeouts';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMongoTestTarget } from './mongo-test-target';

/**
 * Spike — same migration scenario across families. The mongo adapter
 * implements the same `TestTargetAdapter` shape as sqlite/postgres but
 * with a different contract type and a class-based schema IR.
 */

describe('migration spike — mongo', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let mongoTarget: ReturnType<typeof createMongoTestTarget>;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    mongoTarget = createMongoTestTarget({ uri: replSet.getUri() });
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await replSet?.stop().catch(() => {});
  }, timeouts.spinUpMongoMemoryServer);

  it('creates a users collection with a unique email index', async () => {
    const contract: MongoContract = {
      target: 'mongo',
      targetFamily: 'mongo',
      roots: { users: 'User' },
      models: {
        User: {
          fields: {
            _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
            email: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
          },
          relations: {},
          storage: { collection: 'users' },
        },
      },
      storage: {
        collections: {
          users: {
            indexes: [{ keys: [{ field: 'email', direction: 1 as const }], unique: true }],
          },
        },
        storageHash: coreHash('sha256:spike-indexed-contract'),
      },
      capabilities: {},
      extensionPacks: {},
      profileHash: profileHash('sha256:spike'),
      meta: {},
    };

    await applyMigration(mongoTarget, { destination: contract }, async ({ schema, driver }) => {
      const users = schema.collection('users');
      expect(users).toBeDefined();
      expect(users!.indexes.some((i) => i.keys.some((k) => k.field === 'email'))).toBe(true);

      const rawIndexes = await driver.db.collection('users').listIndexes().toArray();
      const emailIdx = rawIndexes.find((i) => i['key']?.['email'] === 1);
      expect(emailIdx?.['unique']).toBe(true);
    });
  });
});
