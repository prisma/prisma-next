import type { MongoValue } from '@prisma-next/mongo-value';
import { MongoAstNode } from './ast-node';
import type { MongoFilterExpr } from './filter-expressions';
import type { MongoReadStage } from './stages';

export class InsertOneCommand extends MongoAstNode {
  readonly kind = 'insertOne' as const;
  readonly collection: string;
  readonly document: Record<string, MongoValue>;

  constructor(collection: string, document: Record<string, MongoValue>) {
    super();
    this.collection = collection;
    this.document = document;
    this.freeze();
  }
}

export class UpdateOneCommand extends MongoAstNode {
  readonly kind = 'updateOne' as const;
  readonly collection: string;
  readonly filter: MongoFilterExpr;
  readonly update: Record<string, MongoValue>;

  constructor(collection: string, filter: MongoFilterExpr, update: Record<string, MongoValue>) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.update = update;
    this.freeze();
  }
}

export class DeleteOneCommand extends MongoAstNode {
  readonly kind = 'deleteOne' as const;
  readonly collection: string;
  readonly filter: MongoFilterExpr;

  constructor(collection: string, filter: MongoFilterExpr) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.freeze();
  }
}

export class InsertManyCommand extends MongoAstNode {
  readonly kind = 'insertMany' as const;
  readonly collection: string;
  readonly documents: ReadonlyArray<Record<string, MongoValue>>;

  constructor(collection: string, documents: ReadonlyArray<Record<string, MongoValue>>) {
    super();
    this.collection = collection;
    this.documents = documents;
    this.freeze();
  }
}

export class UpdateManyCommand extends MongoAstNode {
  readonly kind = 'updateMany' as const;
  readonly collection: string;
  readonly filter: MongoFilterExpr;
  readonly update: Record<string, MongoValue>;

  constructor(collection: string, filter: MongoFilterExpr, update: Record<string, MongoValue>) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.update = update;
    this.freeze();
  }
}

export class DeleteManyCommand extends MongoAstNode {
  readonly kind = 'deleteMany' as const;
  readonly collection: string;
  readonly filter: MongoFilterExpr;

  constructor(collection: string, filter: MongoFilterExpr) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.freeze();
  }
}

export class FindOneAndUpdateCommand extends MongoAstNode {
  readonly kind = 'findOneAndUpdate' as const;
  readonly collection: string;
  readonly filter: MongoFilterExpr;
  readonly update: Record<string, MongoValue>;
  readonly upsert: boolean;

  constructor(
    collection: string,
    filter: MongoFilterExpr,
    update: Record<string, MongoValue>,
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

export class FindOneAndDeleteCommand extends MongoAstNode {
  readonly kind = 'findOneAndDelete' as const;
  readonly collection: string;
  readonly filter: MongoFilterExpr;

  constructor(collection: string, filter: MongoFilterExpr) {
    super();
    this.collection = collection;
    this.filter = filter;
    this.freeze();
  }
}

export type AggregatePipelineEntry = MongoReadStage | Record<string, unknown>;

export class AggregateCommand extends MongoAstNode {
  readonly kind = 'aggregate' as const;
  readonly collection: string;
  readonly pipeline: ReadonlyArray<AggregatePipelineEntry>;

  constructor(collection: string, pipeline: ReadonlyArray<AggregatePipelineEntry>) {
    super();
    this.collection = collection;
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
