import type { PlanMeta } from '@prisma-next/contract/types';
import { createMongoAdapter } from '@prisma-next/mongo-adapter';
import type { MongoCommand, MongoQueryPlan } from '@prisma-next/mongo-core';
import { createMongoDriver, type MongoDriver } from '@prisma-next/mongo-driver';
import { createMongoRuntime, type MongoRuntime } from '../src/mongo-runtime';
import { getConnectionUri, getDbName } from './setup';

const stubMeta: PlanMeta = {
  target: 'mongo',
  storageHash: 'test-hash',
  lane: 'mongo',
  paramDescriptors: [],
};

export function makePlan<Row = unknown>(command: MongoCommand): MongoQueryPlan<Row> {
  return { command, meta: stubMeta };
}

let driver: MongoDriver | undefined;
let runtime: MongoRuntime | undefined;

export async function getRuntime(): Promise<MongoRuntime> {
  if (runtime) return runtime;
  const adapter = createMongoAdapter();
  driver = await createMongoDriver(getConnectionUri(), getDbName());
  runtime = createMongoRuntime({
    adapter,
    driver,
    loweringContext: {
      contract: {} as Parameters<typeof createMongoRuntime>[0]['loweringContext']['contract'],
    },
  });
  return runtime;
}

afterAll(async () => {
  await runtime?.close();
  runtime = undefined;
  driver = undefined;
});
