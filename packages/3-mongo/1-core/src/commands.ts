export abstract class MongoCommand {
  readonly collection: string;

  constructor(collection: string) {
    this.collection = collection;
  }
}

export class FindCommand extends MongoCommand {}
export class InsertOneCommand extends MongoCommand {}
export class UpdateOneCommand extends MongoCommand {}
export class DeleteOneCommand extends MongoCommand {}
export class AggregateCommand extends MongoCommand {}
