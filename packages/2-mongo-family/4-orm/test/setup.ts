import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import type { MongoContract, MongoLoweringContext } from '@prisma-next/mongo-core';
import { createMongoRuntime, type MongoRuntime } from '@prisma-next/mongo-runtime';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export interface OrmTestContext {
  readonly connectionUri: string;
  readonly dbName: string;
  readonly client: MongoClient;
  readonly runtime: MongoRuntime;
}

export async function withMongod<T>(fn: (ctx: OrmTestContext) => Promise<T>): Promise<T> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const connectionUri = replSet.getUri();
  const dbName = 'test';
  const client = new MongoClient(connectionUri);
  await client.connect();

  const adapter = createMongoAdapter();
  const driver = await createMongoDriver(connectionUri, dbName);
  const loweringContext: MongoLoweringContext = {
    contract: {
      targetFamily: 'mongo',
      roots: {},
      storage: { collections: {} },
      models: {},
    } satisfies MongoContract,
  };
  const runtime = createMongoRuntime({ adapter, driver, loweringContext });

  const ctx: OrmTestContext = {
    connectionUri,
    dbName,
    client,
    runtime,
  };

  try {
    return await fn(ctx);
  } finally {
    await runtime.close();
    await client.close();
    await replSet.stop();
  }
}
