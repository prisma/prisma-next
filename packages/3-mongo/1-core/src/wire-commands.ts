export abstract class MongoWireCommand {
  readonly collection: string;

  constructor(collection: string) {
    this.collection = collection;
  }
}

export class FindWireCommand extends MongoWireCommand {}
export class InsertOneWireCommand extends MongoWireCommand {}
export class UpdateOneWireCommand extends MongoWireCommand {}
export class DeleteOneWireCommand extends MongoWireCommand {}
export class AggregateWireCommand extends MongoWireCommand {}
