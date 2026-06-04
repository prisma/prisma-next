import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import { parseMarkerRowSafely } from '@prisma-next/errors/execution';
import type {
  RawAggregateCommand,
  RawFindOneAndUpdateCommand,
  RawInsertOneCommand,
} from '@prisma-next/mongo-query-ast/execution';
import { type } from 'arktype';
import type { Db, Document, UpdateFilter } from 'mongodb';

export const COLLECTION = '_prisma_migrations';
export const MONGO_MARKER_COLLECTION = `_prisma_migrations marker documents in ${COLLECTION}`;
export const MONGO_LEDGER_COLLECTION = `_prisma_migrations ledger documents in ${COLLECTION}`;

const MongoMarkerDocSchema = type({
  space: 'string',
  storageHash: 'string',
  profileHash: 'string',
  'contractJson?': 'unknown | null',
  'canonicalVersion?': 'number | null',
  'updatedAt?': 'Date',
  'appTag?': 'string | null',
  'meta?': type({ '[string]': 'unknown' }).or('null'),
  'invariants?': type('string').array(),
  '+': 'delete',
});

export function parseMongoMarkerDoc(doc: unknown): ContractMarkerRecord {
  const result = MongoMarkerDocSchema(doc);
  if (result instanceof type.errors) {
    throw new Error(`Invalid marker doc on ${COLLECTION}: ${result.summary}`);
  }
  return {
    storageHash: result.storageHash,
    profileHash: result.profileHash,
    contractJson: result.contractJson ?? null,
    canonicalVersion: result.canonicalVersion ?? null,
    updatedAt: result.updatedAt ?? new Date(),
    appTag: result.appTag ?? null,
    meta: (result.meta as Record<string, unknown> | null) ?? {},
    invariants: result.invariants ?? [],
  };
}

export function parseMongoMarkerDocSafely(doc: unknown, space: string): ContractMarkerRecord {
  return parseMarkerRowSafely(doc, parseMongoMarkerDoc, {
    space,
    markerLocation: MONGO_MARKER_COLLECTION,
  });
}

export async function executeAggregate(db: Db, cmd: RawAggregateCommand): Promise<Document[]> {
  return db
    .collection(cmd.collection)
    .aggregate(cmd.pipeline as Record<string, unknown>[])
    .toArray();
}

export async function executeInsertOne(db: Db, cmd: RawInsertOneCommand): Promise<void> {
  await db.collection(cmd.collection).insertOne(cmd.document);
}

export async function executeFindOneAndUpdate(
  db: Db,
  cmd: RawFindOneAndUpdateCommand,
): Promise<Document | null> {
  return db
    .collection(cmd.collection)
    .findOneAndUpdate(cmd.filter, cmd.update as UpdateFilter<Document> | Document[], {
      upsert: cmd.upsert,
    });
}
