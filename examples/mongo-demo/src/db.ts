import { createTelemetryMiddleware } from '@prisma-next/middleware-telemetry';
import mongo from '@prisma-next/mongo/runtime';
import type { MongoRuntime } from '@prisma-next/mongo-runtime';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export async function createClient(connectionUri: string, dbName: string) {
  const db = mongo<Contract>({
    contractJson,
    url: connectionUri,
    dbName,
    middleware: [createTelemetryMiddleware()],
  });
  const runtime = await db.runtime();
  return { orm: db.orm, runtime, query: db.query, contract: db.contract };
}

export type Db = Awaited<ReturnType<typeof createClient>>;
export type { MongoRuntime };
