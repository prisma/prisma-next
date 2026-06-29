import { createCacheMiddleware } from '@prisma-next/middleware-cache';
import mongo from '@prisma-next/mongo/runtime';
import { mongoRaw } from '@prisma-next/mongo-orm';
import type { MongoRuntime } from '@prisma-next/mongo-runtime';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export async function createClient(connectionUri: string, dbName: string) {
  const db = mongo<Contract>({
    contractJson,
    url: connectionUri,
    dbName,
    middleware: [createCacheMiddleware()],
  });
  const runtime = await db.runtime();
  const raw = mongoRaw({ contract: db.contract });
  return { ...db, runtime, raw };
}

export type Db = Awaited<ReturnType<typeof createClient>>;
export type { MongoRuntime };
