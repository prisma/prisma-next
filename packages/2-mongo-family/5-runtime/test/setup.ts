import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import type { PlanMeta } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import type { MongoLoweringContext } from '@prisma-next/mongo-core';
import { timeouts } from '@prisma-next/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMongoRuntime, type MongoRuntime } from '../src/mongo-runtime';

export interface MongodContext {
  readonly connectionUri: string;
  readonly dbName: string;
  readonly client: MongoClient;
  readonly runtime: MongoRuntime;
  readonly stubMeta: PlanMeta;
}

const stubMeta: PlanMeta = {
  target: 'mongo',
  storageHash: 'test-hash',
  lane: 'mongo',
  paramDescriptors: [],
};

export async function withMongod<T>(fn: (ctx: MongodContext) => Promise<T>): Promise<T> {
  const replSet = await MongoMemoryReplSet.create({
    instanceOpts: [{ launchTimeout: timeouts.spinUpDbServer, storageEngine: 'wiredTiger' }],
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
      target: 'mongo',
      targetFamily: 'mongo',
      roots: {},
      storage: { storageHash: coreHash('sha256:test'), collections: {} },
      models: {},
      capabilities: {},
      extensionPacks: {},
      profileHash: profileHash('sha256:test'),
      meta: {},
    },
  };
  const runtime = createMongoRuntime({ adapter, driver, loweringContext });

  const ctx: MongodContext = {
    connectionUri,
    dbName,
    client,
    runtime,
    stubMeta,
  };

  try {
    return await fn(ctx);
  } finally {
    await runtime.close();
    await client.close();
    await replSet.stop();
  }
}
