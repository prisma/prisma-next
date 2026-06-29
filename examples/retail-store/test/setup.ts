import { timeouts } from '@prisma-next/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createClient, type Db } from '../src/db';

export function setupTestDb(dbName: string) {
  let replSet: MongoMemoryReplSet;
  let nativeClient: MongoClient;
  let db: Db;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    nativeClient = new MongoClient(replSet.getUri());
    await nativeClient.connect();
    db = createClient(replSet.getUri(), dbName);
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await nativeClient.db(dbName).dropDatabase();
  });

  afterAll(async () => {
    await Promise.allSettled([db?.close(), nativeClient?.close(), replSet?.stop()]);
  }, timeouts.spinUpMongoMemoryServer);

  return {
    get db() {
      return db;
    },
  };
}
