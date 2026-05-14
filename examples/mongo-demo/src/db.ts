import mongoRuntimeAdapter from '@prisma-next/adapter-mongo/runtime';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import { MongoContractSerializer } from '@prisma-next/family-mongo/ir';
import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';
import { mongoOrm } from '@prisma-next/mongo-orm';
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

const contract = new MongoContractSerializer().deserializeContract(contractJson) as Contract;

const query = mongoQuery<Contract>({ contractJson });

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
    middleware: [createTelemetryMiddleware()],
  });
  const orm = mongoOrm({ contract, executor: runtime });

  return { orm, runtime, query, contract };
}

export type Db = Awaited<ReturnType<typeof createClient>>;
export type { MongoRuntime };
