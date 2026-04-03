import type { AnyMongoCommand } from './commands';
import type { MongoContract } from './contract-types';
import type { AnyMongoWireCommand } from './wire-commands';

export interface MongoLoweringContext {
  readonly contract: MongoContract;
}

export interface MongoAdapter {
  lowerCommand(command: AnyMongoCommand, context: MongoLoweringContext): AnyMongoWireCommand;
}
