import type { MongoExpr, MongoUpdateDocument, MongoValue, RawPipeline } from './values';

abstract class MongoCommand {
  abstract readonly kind: string;
  readonly collection: string;

  protected constructor(collection: string) {
    this.collection = collection;
  }

  protected freeze(): void {
    Object.freeze(this);
  }
}

export class InsertOneCommand extends MongoCommand {
  readonly kind = 'insertOne' as const;
  readonly document: Record<string, MongoValue>;

  constructor(collection: string, document: Record<string, MongoValue>) {
    super(collection);
    this.document = document;
    this.freeze();
  }
}

export class UpdateOneCommand extends MongoCommand {
  readonly kind = 'updateOne' as const;
  readonly filter: MongoExpr;
  readonly update: MongoUpdateDocument;

  constructor(collection: string, filter: MongoExpr, update: MongoUpdateDocument) {
    super(collection);
    this.filter = filter;
    this.update = update;
    this.freeze();
  }
}

export class DeleteOneCommand extends MongoCommand {
  readonly kind = 'deleteOne' as const;
  readonly filter: MongoExpr;

  constructor(collection: string, filter: MongoExpr) {
    super(collection);
    this.filter = filter;
    this.freeze();
  }
}

export class InsertManyCommand extends MongoCommand {
  readonly kind = 'insertMany' as const;
  readonly documents: ReadonlyArray<Record<string, MongoValue>>;

  constructor(collection: string, documents: ReadonlyArray<Record<string, MongoValue>>) {
    super(collection);
    this.documents = documents;
    this.freeze();
  }
}

export class UpdateManyCommand extends MongoCommand {
  readonly kind = 'updateMany' as const;
  readonly filter: MongoExpr;
  readonly update: MongoUpdateDocument;

  constructor(collection: string, filter: MongoExpr, update: MongoUpdateDocument) {
    super(collection);
    this.filter = filter;
    this.update = update;
    this.freeze();
  }
}

export class DeleteManyCommand extends MongoCommand {
  readonly kind = 'deleteMany' as const;
  readonly filter: MongoExpr;

  constructor(collection: string, filter: MongoExpr) {
    super(collection);
    this.filter = filter;
    this.freeze();
  }
}

export class FindOneAndUpdateCommand extends MongoCommand {
  readonly kind = 'findOneAndUpdate' as const;
  readonly filter: MongoExpr;
  readonly update: MongoUpdateDocument;
  readonly upsert: boolean;

  constructor(collection: string, filter: MongoExpr, update: MongoUpdateDocument, upsert: boolean) {
    super(collection);
    this.filter = filter;
    this.update = update;
    this.upsert = upsert;
    this.freeze();
  }
}

export class FindOneAndDeleteCommand extends MongoCommand {
  readonly kind = 'findOneAndDelete' as const;
  readonly filter: MongoExpr;

  constructor(collection: string, filter: MongoExpr) {
    super(collection);
    this.filter = filter;
    this.freeze();
  }
}

export class AggregateCommand extends MongoCommand {
  readonly kind = 'aggregate' as const;
  readonly pipeline: RawPipeline;

  constructor(collection: string, pipeline: RawPipeline) {
    super(collection);
    this.pipeline = pipeline;
    this.freeze();
  }
}

export type AnyMongoCommand =
  | InsertOneCommand
  | InsertManyCommand
  | UpdateOneCommand
  | UpdateManyCommand
  | DeleteOneCommand
  | DeleteManyCommand
  | FindOneAndUpdateCommand
  | FindOneAndDeleteCommand
  | AggregateCommand;
