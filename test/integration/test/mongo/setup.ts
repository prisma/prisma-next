import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import type { MongoLoweringContext } from '@prisma-next/mongo-core';
import { createMongoRuntime, type MongoRuntime } from '@prisma-next/mongo-runtime';
import { timeouts } from '@prisma-next/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';

export interface MongodContext {
  readonly connectionUri: string;
  readonly dbName: string;
  readonly client: MongoClient;
  readonly runtime: MongoRuntime;
}

export function describeWithMongoDB(name: string, fn: (ctx: MongodContext) => void): void {
  describe(name, { timeout: timeouts.spinUpDbServer }, () => {
    let replSet: MongoMemoryReplSet;
    let client: MongoClient;
    let runtime: MongoRuntime;
    const dbName = 'test';

    const ctx: MongodContext = {
      get connectionUri() {
        return replSet.getUri();
      },
      dbName,
      get client() {
        return client;
      },
      get runtime() {
        return runtime;
      },
    };

    beforeAll(async () => {
      replSet = await MongoMemoryReplSet.create({
        replSet: { count: 1, storageEngine: 'wiredTiger' },
      });
      client = new MongoClient(replSet.getUri());
      await client.connect();

      const adapter = createMongoAdapter();
      const driver = await createMongoDriver(replSet.getUri(), dbName);
      const loweringContext: MongoLoweringContext = {
        contract: { targetFamily: 'mongo', roots: {}, storage: { collections: {} }, models: {} },
      };
      runtime = createMongoRuntime({ adapter, driver, loweringContext });
    }, timeouts.spinUpDbServer);

    beforeEach(async () => {
      await client.db(dbName).dropDatabase();
    });

    afterAll(async () => {
      try {
        await runtime?.close();
        await client?.close();
        await replSet?.stop();
      } catch {
        // Ignore cleanup errors
      }
    }, timeouts.spinUpDbServer);

    fn(ctx);
  });
}
