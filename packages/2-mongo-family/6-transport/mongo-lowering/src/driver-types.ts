import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import type { AnyMongoWireCommand } from '@prisma-next/mongo-wire';
import type { Db } from 'mongodb';

export interface MongoDriver {
  execute<Row>(wireCommand: AnyMongoWireCommand): AsyncIterable<Row>;
  close(): Promise<void>;
}

export interface MongoControlDriverInstance
  extends ControlDriverInstance<'mongo', 'mongo'>,
    MongoDriver {
  readonly db: Db;
}
