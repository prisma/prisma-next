import mongoRuntimeAdapter from '@prisma-next/adapter-mongo/runtime';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import { MongoContractSerializer } from '@prisma-next/family-mongo/ir';
import { mongoOrm, mongoRaw } from '@prisma-next/mongo-orm';
import { mongoQuery } from '@prisma-next/mongo-query-builder';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
  type MongoRuntime,
} from '@prisma-next/mongo-runtime';
import mongoRuntimeTarget from '@prisma-next/target-mongo/runtime';
import { timeouts } from '@prisma-next/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { Contract } from '../src/contract';
import contractJson from '../src/contract.json' with { type: 'json' };
import type { Db } from '../src/db';

const contract = new MongoContractSerializer().deserializeContract<Contract>(contractJson);
const query = mongoQuery<Contract>({ contractJson });
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

    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    const context = createMongoExecutionContext({ contract, stack });
    const driver = await createMongoDriver(replSet.getUri(), dbName);
    runtime = createMongoRuntime({ context, driver });
    const orm = mongoOrm({ contract, executor: runtime });

    db = { orm, runtime, query, raw, contract };
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  afterAll(async () => {
    await Promise.allSettled([runtime?.close(), client?.close(), replSet?.stop()]);
  }, timeouts.spinUpMongoMemoryServer);

  return {
    get db() {
      return db;
    },
  };
}
