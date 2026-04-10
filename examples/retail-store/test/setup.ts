import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import { mongoOrm, mongoRaw } from '@prisma-next/mongo-orm';
import { mongoPipeline } from '@prisma-next/mongo-pipeline-builder';
import { createMongoRuntime, type MongoRuntime } from '@prisma-next/mongo-runtime';
import { timeouts } from '@prisma-next/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { Contract } from '../src/contract';
import contractJson from '../src/contract.json' with { type: 'json' };
import type { Db } from '../src/db';

const { contract } = validateMongoContract<Contract>(contractJson);
const pipeline = mongoPipeline<Contract>({ contractJson });
const raw = mongoRaw({ contract });

export function setupTestDb(dbName: string) {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let runtime: MongoRuntime;
  let db: Db;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();

    const adapter = createMongoAdapter();
    const driver = await createMongoDriver(replSet.getUri(), dbName);
    runtime = createMongoRuntime({ adapter, driver });
    const orm = mongoOrm({ contract, executor: runtime });

    db = { orm, runtime, pipeline, raw, contract };
  }, timeouts.spinUpDbServer);

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  afterAll(async () => {
    await Promise.allSettled([runtime?.close(), client?.close(), replSet?.stop()]);
  }, timeouts.spinUpDbServer);

  return {
    get db() {
      return db;
    },
  };
}
