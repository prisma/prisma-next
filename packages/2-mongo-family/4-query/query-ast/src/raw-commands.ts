import { MongoAstNode } from './ast-node';

type RawDocument = Record<string, unknown>;

export class RawAggregateCommand extends MongoAstNode {
  readonly kind = 'rawAggregate' as const;
  readonly collection: string;
  readonly pipeline: ReadonlyArray<RawDocument>;

  constructor(collection: string, pipeline: ReadonlyArray<RawDocument>) {
    super();
    this.collection = collection;
    this.pipeline = pipeline;
    this.freeze();
  }
}

export class RawInsertOneCommand extends MongoAstNode {
  readonly kind = 'rawInsertOne' as const;
  readonly collection: string;
  readonly document: RawDocument;

  constructor(collection: string, document: RawDocument) {
    super();
    this.collection = collection;
    this.document = document;
    this.freeze();
  }
}

export class RawInsertManyCommand extends MongoAstNode {
  readonly kind = 'rawInsertMany' as const;
  readonly collection: string;
  readonly documents: ReadonlyArray<RawDocument>;

  constructor(collection: string, documents: ReadonlyArray<RawDocument>) {
    super();
    this.collection = collection;
    this.documents = documents;
    this.freeze();
  }
}

export class RawUpdateOneCommand extends MongoAstNode {
  readonly kind = 'rawUpdateOne' as const;
  readonly collection: string;
  readonly filter: RawDocument;
  readonly update: RawDocument | ReadonlyArray<RawDocument>;

  constructor(
    collection: string,
    filter: RawDocument,
    update: RawDocument | ReadonlyArray<RawDocument>,
  ) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.update = update;
    this.freeze();
  }
}

export class RawUpdateManyCommand extends MongoAstNode {
  readonly kind = 'rawUpdateMany' as const;
  readonly collection: string;
  readonly filter: RawDocument;
  readonly update: RawDocument | ReadonlyArray<RawDocument>;

  constructor(
    collection: string,
    filter: RawDocument,
    update: RawDocument | ReadonlyArray<RawDocument>,
  ) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.update = update;
    this.freeze();
  }
}

export class RawDeleteOneCommand extends MongoAstNode {
  readonly kind = 'rawDeleteOne' as const;
  readonly collection: string;
  readonly filter: RawDocument;

  constructor(collection: string, filter: RawDocument) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.freeze();
  }
}

export class RawDeleteManyCommand extends MongoAstNode {
  readonly kind = 'rawDeleteMany' as const;
  readonly collection: string;
  readonly filter: RawDocument;

  constructor(collection: string, filter: RawDocument) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.freeze();
  }
}

export class RawFindOneAndUpdateCommand extends MongoAstNode {
  readonly kind = 'rawFindOneAndUpdate' as const;
  readonly collection: string;
  readonly filter: RawDocument;
  readonly update: RawDocument | ReadonlyArray<RawDocument>;
  readonly upsert: boolean;

  constructor(
    collection: string,
    filter: RawDocument,
    update: RawDocument | ReadonlyArray<RawDocument>,
    upsert: boolean,
  ) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.update = update;
    this.upsert = upsert;
    this.freeze();
  }
}

export class RawFindOneAndDeleteCommand extends MongoAstNode {
  readonly kind = 'rawFindOneAndDelete' as const;
  readonly collection: string;
  readonly filter: RawDocument;

  constructor(collection: string, filter: RawDocument) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.freeze();
  }
}

export type RawMongoCommand =
  | RawAggregateCommand
  | RawInsertOneCommand
  | RawInsertManyCommand
  | RawUpdateOneCommand
  | RawUpdateManyCommand
  | RawDeleteOneCommand
  | RawDeleteManyCommand
  | RawFindOneAndUpdateCommand
  | RawFindOneAndDeleteCommand;
