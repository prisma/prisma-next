import type { RawPipeline } from './values';

export type Document = Record<string, unknown>;

abstract class MongoWireCommand {
  abstract readonly kind: string;
  readonly collection: string;

  protected constructor(collection: string) {
    this.collection = collection;
  }

  protected freeze(): void {
    Object.freeze(this);
  }
}

export class FindWireCommand extends MongoWireCommand {
  readonly kind = 'find' as const;
  readonly filter: Document | undefined;
  readonly projection: Document | undefined;
  readonly sort: Document | undefined;
  readonly limit: number | undefined;
  readonly skip: number | undefined;

  constructor(
    collection: string,
    filter?: Document,
    options?: {
      projection?: Document;
      sort?: Document;
      limit?: number;
      skip?: number;
    },
  ) {
    super(collection);
    this.filter = filter;
    this.projection = options?.projection;
    this.sort = options?.sort;
    this.limit = options?.limit;
    this.skip = options?.skip;
    this.freeze();
  }
}

export class InsertOneWireCommand extends MongoWireCommand {
  readonly kind = 'insertOne' as const;
  readonly document: Document;

  constructor(collection: string, document: Document) {
    super(collection);
    this.document = document;
    this.freeze();
  }
}

export class UpdateOneWireCommand extends MongoWireCommand {
  readonly kind = 'updateOne' as const;
  readonly filter: Document;
  readonly update: Document;

  constructor(collection: string, filter: Document, update: Document) {
    super(collection);
    this.filter = filter;
    this.update = update;
    this.freeze();
  }
}

export class DeleteOneWireCommand extends MongoWireCommand {
  readonly kind = 'deleteOne' as const;
  readonly filter: Document;

  constructor(collection: string, filter: Document) {
    super(collection);
    this.filter = filter;
    this.freeze();
  }
}

export class AggregateWireCommand extends MongoWireCommand {
  readonly kind = 'aggregate' as const;
  readonly pipeline: RawPipeline;

  constructor(collection: string, pipeline: RawPipeline) {
    super(collection);
    this.pipeline = pipeline;
    this.freeze();
  }
}

export type AnyMongoWireCommand =
  | FindWireCommand
  | InsertOneWireCommand
  | UpdateOneWireCommand
  | DeleteOneWireCommand
  | AggregateWireCommand;
