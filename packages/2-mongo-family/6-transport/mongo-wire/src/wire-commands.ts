import type { Document, RawPipeline } from '@prisma-next/mongo-value';

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
  readonly update: Document | ReadonlyArray<Document>;
  readonly upsert: boolean;

  constructor(
    collection: string,
    filter: Document,
    update: Document | ReadonlyArray<Document>,
    upsert = false,
  ) {
    super(collection);
    this.filter = filter;
    this.update = update;
    this.upsert = upsert;
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

export class InsertManyWireCommand extends MongoWireCommand {
  readonly kind = 'insertMany' as const;
  readonly documents: ReadonlyArray<Document>;

  constructor(collection: string, documents: ReadonlyArray<Document>) {
    super(collection);
    this.documents = documents;
    this.freeze();
  }
}

export class UpdateManyWireCommand extends MongoWireCommand {
  readonly kind = 'updateMany' as const;
  readonly filter: Document;
  readonly update: Document | ReadonlyArray<Document>;
  readonly upsert: boolean;

  constructor(
    collection: string,
    filter: Document,
    update: Document | ReadonlyArray<Document>,
    upsert = false,
  ) {
    super(collection);
    this.filter = filter;
    this.update = update;
    this.upsert = upsert;
    this.freeze();
  }
}

export class DeleteManyWireCommand extends MongoWireCommand {
  readonly kind = 'deleteMany' as const;
  readonly filter: Document;

  constructor(collection: string, filter: Document) {
    super(collection);
    this.filter = filter;
    this.freeze();
  }
}

export class FindOneAndUpdateWireCommand extends MongoWireCommand {
  readonly kind = 'findOneAndUpdate' as const;
  readonly filter: Document;
  readonly update: Document | ReadonlyArray<Document>;
  readonly upsert: boolean;
  readonly sort: Record<string, 1 | -1> | undefined;
  /**
   * When `undefined`, the option is omitted from the underlying driver
   * call so Mongo's documented default (pre-image document) applies.
   */
  readonly returnDocument: 'before' | 'after' | undefined;

  constructor(
    collection: string,
    filter: Document,
    update: Document | ReadonlyArray<Document>,
    upsert = false,
    sort?: Record<string, 1 | -1>,
    returnDocument?: 'before' | 'after',
  ) {
    super(collection);
    this.filter = filter;
    this.update = update;
    this.upsert = upsert;
    this.sort = sort;
    this.returnDocument = returnDocument;
    this.freeze();
  }
}

export class FindOneAndDeleteWireCommand extends MongoWireCommand {
  readonly kind = 'findOneAndDelete' as const;
  readonly filter: Document;
  readonly sort: Record<string, 1 | -1> | undefined;

  constructor(collection: string, filter: Document, sort?: Record<string, 1 | -1>) {
    super(collection);
    this.filter = filter;
    this.sort = sort;
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
  | InsertOneWireCommand
  | InsertManyWireCommand
  | UpdateOneWireCommand
  | UpdateManyWireCommand
  | DeleteOneWireCommand
  | DeleteManyWireCommand
  | FindOneAndUpdateWireCommand
  | FindOneAndDeleteWireCommand
  | AggregateWireCommand;
