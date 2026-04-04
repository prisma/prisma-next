import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import { validateMongoContract } from '@prisma-next/mongo-core';
import { mongoOrm } from '@prisma-next/mongo-orm';
import { createMongoRuntime, type MongoRuntime } from '@prisma-next/mongo-runtime';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

const { contract } = validateMongoContract<Contract>(contractJson);

export async function createClient(connectionUri: string, dbName: string) {
  const adapter = createMongoAdapter();
  const driver = await createMongoDriver(connectionUri, dbName);
  const runtime = createMongoRuntime({ adapter, driver });
  const orm = mongoOrm({ contract, executor: runtime });

  return { orm, runtime, contract };
}

export type Db = Awaited<ReturnType<typeof createClient>>;
export type { MongoRuntime };
