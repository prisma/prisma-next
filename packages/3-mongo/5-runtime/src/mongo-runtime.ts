import type { DocumentContract } from '@prisma-next/contract/types';
import type { MongoAdapter } from '@prisma-next/mongo-adapter';
import type { MongoQueryPlan } from '@prisma-next/mongo-core';
import type { MongoDriver } from '@prisma-next/mongo-driver';
import type { AsyncIterableResult } from '@prisma-next/runtime-executor';

export interface MongoRuntimeOptions {
  readonly contract: DocumentContract;
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
}

export interface MongoRuntime {
  execute<Row = Record<string, unknown>>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row>;
  close(): Promise<void>;
}

export function createMongoRuntime(_options: MongoRuntimeOptions): MongoRuntime {
  throw new Error('not implemented');
}
