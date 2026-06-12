import type {
  CollModOptions,
  CreateCollectionOptions,
  CreateIndexOptions,
} from '@prisma-next/mongo-query-ast/control';
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

export class CreateCollectionWireCommand extends MongoWireCommand {
  readonly kind = 'createCollection' as const;
  readonly options: Partial<CreateCollectionOptions>;

  constructor(collection: string, options: Partial<CreateCollectionOptions>) {
    super(collection);
    this.options = options;
    this.freeze();
  }
}

export class CreateIndexWireCommand extends MongoWireCommand {
  readonly kind = 'createIndex' as const;
  readonly key: Record<string, number | string>;
  readonly options: Partial<CreateIndexOptions>;

  constructor(
    collection: string,
    key: Record<string, number | string>,
    options: Partial<CreateIndexOptions>,
  ) {
    super(collection);
    this.key = key;
    this.options = options;
    this.freeze();
  }
}

export class DropCollectionWireCommand extends MongoWireCommand {
  readonly kind = 'dropCollection' as const;

  constructor(collection: string) {
    super(collection);
    this.freeze();
  }
}

export class DropIndexWireCommand extends MongoWireCommand {
  readonly kind = 'dropIndex' as const;
  readonly name: string;

  constructor(collection: string, name: string) {
    super(collection);
    this.name = name;
    this.freeze();
  }
}

export class CollModWireCommand extends MongoWireCommand {
  readonly kind = 'collMod' as const;
  readonly options: Partial<CollModOptions>;

  constructor(collection: string, options: Partial<CollModOptions>) {
    super(collection);
    this.options = options;
    this.freeze();
  }
}

export type AnyMongoDmlWireCommand =
  | InsertOneWireCommand
  | InsertManyWireCommand
  | UpdateOneWireCommand
  | UpdateManyWireCommand
  | DeleteOneWireCommand
  | DeleteManyWireCommand
  | FindOneAndUpdateWireCommand
  | FindOneAndDeleteWireCommand
  | AggregateWireCommand;

export type AnyMongoDdlWireCommand =
  | CreateCollectionWireCommand
  | CreateIndexWireCommand
  | DropCollectionWireCommand
  | DropIndexWireCommand
  | CollModWireCommand;

export type AnyMongoWireCommand = AnyMongoDmlWireCommand | AnyMongoDdlWireCommand;

const DDL_KINDS: ReadonlySet<string> = new Set([
  'createCollection',
  'createIndex',
  'dropCollection',
  'dropIndex',
  'collMod',
]);

export function isDdlWireCommand(cmd: AnyMongoWireCommand): cmd is AnyMongoDdlWireCommand {
  return DDL_KINDS.has(cmd.kind);
}
