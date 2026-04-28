import mongoRuntimeAdapter from '@prisma-next/adapter-mongo/runtime';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import { mongoOrm, mongoRaw } from '@prisma-next/mongo-orm';
import { mongoQuery } from '@prisma-next/mongo-query-builder';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
  type MongoRuntime,
} from '@prisma-next/mongo-runtime';
import mongoRuntimeTarget from '@prisma-next/target-mongo/runtime';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

const { contract } = validateMongoContract<Contract>(contractJson);

const query = mongoQuery<Contract>({ contractJson });
const raw = mongoRaw({ contract });

export async function createClient(connectionUri: string, dbName: string) {
  const stack = createMongoExecutionStack({
    target: mongoRuntimeTarget,
    adapter: mongoRuntimeAdapter,
  });
  const context = createMongoExecutionContext({ contract, stack });
  const driver = await createMongoDriver(connectionUri, dbName);
  const runtime = createMongoRuntime({
    context,
    driver,
  });
  const orm = mongoOrm({ contract, executor: runtime });

  return { orm, runtime, query, raw, contract };
}

export type Db = Awaited<ReturnType<typeof createClient>>;
export type { MongoRuntime };
