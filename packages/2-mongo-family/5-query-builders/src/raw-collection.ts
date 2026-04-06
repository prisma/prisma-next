import type { PlanMeta } from '@prisma-next/contract/types';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast';
import {
  RawAggregateCommand,
  RawDeleteManyCommand,
  RawDeleteOneCommand,
  RawFindOneAndDeleteCommand,
  RawFindOneAndUpdateCommand,
  RawInsertManyCommand,
  RawInsertOneCommand,
  RawUpdateManyCommand,
  RawUpdateOneCommand,
} from '@prisma-next/mongo-query-ast';

type RawDocument = Record<string, unknown>;

interface Buildable<Row = unknown> {
  build(): MongoQueryPlan<Row>;
}

export interface RawMongoCollection {
  aggregate<Row = Record<string, unknown>>(pipeline: ReadonlyArray<RawDocument>): Buildable<Row>;

  insertOne(document: RawDocument): Buildable;
  insertMany(documents: ReadonlyArray<RawDocument>): Buildable;

  updateOne(filter: RawDocument, update: RawDocument | ReadonlyArray<RawDocument>): Buildable;

  updateMany(filter: RawDocument, update: RawDocument | ReadonlyArray<RawDocument>): Buildable;

  deleteOne(filter: RawDocument): Buildable;
  deleteMany(filter: RawDocument): Buildable;

  findOneAndUpdate(
    filter: RawDocument,
    update: RawDocument | ReadonlyArray<RawDocument>,
    options?: { upsert?: boolean },
  ): Buildable;

  findOneAndDelete(filter: RawDocument): Buildable;
}

export function createRawMongoCollection(
  collectionName: string,
  meta: PlanMeta,
): RawMongoCollection {
  function buildable<Row>(command: MongoQueryPlan['command']): Buildable<Row> {
    return {
      build: () => ({ collection: collectionName, command, meta }),
    };
  }

  return {
    aggregate<Row = Record<string, unknown>>(pipeline: ReadonlyArray<RawDocument>) {
      return buildable<Row>(new RawAggregateCommand(collectionName, pipeline));
    },

    insertOne(document: RawDocument) {
      return buildable(new RawInsertOneCommand(collectionName, document));
    },

    insertMany(documents: ReadonlyArray<RawDocument>) {
      return buildable(new RawInsertManyCommand(collectionName, documents));
    },

    updateOne(filter: RawDocument, update: RawDocument | ReadonlyArray<RawDocument>) {
      return buildable(new RawUpdateOneCommand(collectionName, filter, update));
    },

    updateMany(filter: RawDocument, update: RawDocument | ReadonlyArray<RawDocument>) {
      return buildable(new RawUpdateManyCommand(collectionName, filter, update));
    },

    deleteOne(filter: RawDocument) {
      return buildable(new RawDeleteOneCommand(collectionName, filter));
    },

    deleteMany(filter: RawDocument) {
      return buildable(new RawDeleteManyCommand(collectionName, filter));
    },

    findOneAndUpdate(
      filter: RawDocument,
      update: RawDocument | ReadonlyArray<RawDocument>,
      options?: { upsert?: boolean },
    ) {
      return buildable(
        new RawFindOneAndUpdateCommand(collectionName, filter, update, options?.upsert ?? false),
      );
    },

    findOneAndDelete(filter: RawDocument) {
      return buildable(new RawFindOneAndDeleteCommand(collectionName, filter));
    },
  };
}
