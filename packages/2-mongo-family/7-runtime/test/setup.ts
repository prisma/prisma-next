import { createDefaultMongoCodecRegistry, createMongoAdapter } from '@prisma-next/adapter-mongo';
import type { PlanMeta } from '@prisma-next/contract/types';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import type { MongoCodecRegistry } from '@prisma-next/mongo-codec';
import { timeouts } from '@prisma-next/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createMongoRuntime, type MongoRuntime } from '../src/mongo-runtime';

export interface MongodContext {
  readonly connectionUri: string;
  readonly dbName: string;
  readonly client: MongoClient;
  readonly runtime: MongoRuntime;
  readonly codecs: MongoCodecRegistry;
  readonly stubMeta: PlanMeta;
}

const stubMeta: PlanMeta = {
  target: 'mongo',
  storageHash: 'test-hash',
  lane: 'mongo',
};

export async function withMongod<T>(fn: (ctx: MongodContext) => Promise<T>): Promise<T> {
  const replSet = await MongoMemoryReplSet.create({
    instanceOpts: [
      { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
    ],
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const connectionUri = replSet.getUri();
  const dbName = 'test';
  const client = new MongoClient(connectionUri);
  await client.connect();

  const codecs = createDefaultMongoCodecRegistry();
  const adapter = createMongoAdapter(codecs);
  const driver = await createMongoDriver(connectionUri, dbName);
  const runtime = createMongoRuntime({ adapter, driver, contract: {}, targetId: 'mongo', codecs });

  const ctx: MongodContext = {
    connectionUri,
    dbName,
    client,
    runtime,
    codecs,
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
