import type { MongoWireCommand } from '@prisma-next/mongo-core';

export interface MongoDriver {
  execute<Row = Record<string, unknown>>(wireCommand: MongoWireCommand): AsyncIterable<Row>;
  close(): Promise<void>;
}

export function createMongoDriver(_uri: string, _dbName: string): MongoDriver {
  throw new Error('not implemented');
}
