import { createCacheMiddleware } from '@prisma-next/middleware-cache';
import mongo from '@prisma-next/mongo/runtime';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export function createClient(connectionUri: string, dbName: string) {
  return mongo<Contract>({
    contractJson,
    url: connectionUri,
    dbName,
    middleware: [createCacheMiddleware()],
  });
}

export type Db = ReturnType<typeof createClient>;
