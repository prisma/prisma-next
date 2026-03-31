import type { AnyMongoWireCommand } from './wire-commands';

export interface MongoDriver {
  execute<Row>(wireCommand: AnyMongoWireCommand): AsyncIterable<Row>;
  close(): Promise<void>;
}
