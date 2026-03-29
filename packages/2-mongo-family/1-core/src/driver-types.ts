import type { AnyMongoWireCommand } from './wire-commands';

export interface MongoDriver {
  execute<Row = Record<string, unknown>>(wireCommand: AnyMongoWireCommand): AsyncIterable<Row>;
  close(): Promise<void>;
}
