import type { AnyMongoWireCommand } from '@prisma-next/mongo-wire';

export interface MongoDriver {
  execute<Row>(wireCommand: AnyMongoWireCommand): AsyncIterable<Row>;
  close(): Promise<void>;
}
