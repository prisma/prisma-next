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

export interface FindOptions {
  readonly projection?: Record<string, 1 | 0>;
  readonly sort?: Record<string, 1 | -1>;
  readonly limit?: number;
  readonly skip?: number;
}

export class FindCommand extends MongoCommand {
  readonly kind = 'find' as const;
  readonly filter: MongoExpr | undefined;
  readonly projection: Record<string, 1 | 0> | undefined;
  readonly sort: Record<string, 1 | -1> | undefined;
  readonly limit: number | undefined;
  readonly skip: number | undefined;

  constructor(collection: string, filter?: MongoExpr, options?: FindOptions) {
    super(collection);
    this.filter = filter;
    this.projection = options?.projection;
    this.sort = options?.sort;
    this.limit = options?.limit;
    this.skip = options?.skip;
    this.freeze();
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
  | FindCommand
  | InsertOneCommand
  | UpdateOneCommand
  | DeleteOneCommand
  | AggregateCommand;
