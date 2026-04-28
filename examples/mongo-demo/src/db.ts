import mongoRuntimeAdapter from '@prisma-next/adapter-mongo/runtime';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import { createCacheMiddleware } from '@prisma-next/middleware-cache';
import { validateMongoContract } from '@prisma-next/mongo-contract';
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

const { contract } = validateMongoContract<Contract>(contractJson);

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
    // Cross-family cache middleware. The package depends only on
    // `@prisma-next/framework-components/runtime` — cache keys come from
    // `ctx.contentHash(exec)`, which `MongoRuntimeImpl` populates the same
    // way `SqlRuntimeImpl` does, so the middleware works against Mongo
    // out of the box. See `scripts/cache-demo.ts` for an annotated read
    // that exercises this end-to-end.
    middleware: [createCacheMiddleware({ maxEntries: 1_000 })],
  });
  const orm = mongoOrm({ contract, executor: runtime });

  return { orm, runtime, query, contract };
}

export type Db = Awaited<ReturnType<typeof createClient>>;
export type { MongoRuntime };
