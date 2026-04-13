import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import {
  RawAggregateCommand,
  RawFindOneAndUpdateCommand,
  RawInsertOneCommand,
} from '@prisma-next/mongo-query-ast/execution';
import type { Db, Document } from 'mongodb';

const COLLECTION = '_prisma_migrations';
const MARKER_ID = 'marker';

async function executeAggregate(db: Db, cmd: RawAggregateCommand): Promise<Document[]> {
  return db
    .collection(cmd.collection)
    .aggregate(cmd.pipeline as Record<string, unknown>[])
    .toArray();
}

async function executeInsertOne(db: Db, cmd: RawInsertOneCommand): Promise<void> {
  await db.collection(cmd.collection).insertOne(cmd.document);
}

async function executeFindOneAndUpdate(
  db: Db,
  cmd: RawFindOneAndUpdateCommand,
): Promise<Document | null> {
  return db
    .collection(cmd.collection)
    .findOneAndUpdate(cmd.filter, cmd.update as Record<string, unknown>, { upsert: cmd.upsert });
}

export async function readMarker(db: Db): Promise<ContractMarkerRecord | null> {
  const cmd = new RawAggregateCommand(COLLECTION, [{ $match: { _id: MARKER_ID } }, { $limit: 1 }]);
  const docs = await executeAggregate(db, cmd);
  const doc = docs[0];
  if (!doc) return null;
  return {
    storageHash: doc['storageHash'] as string,
    profileHash: doc['profileHash'] as string,
    contractJson: (doc['contractJson'] as unknown) ?? null,
    canonicalVersion: (doc['canonicalVersion'] as number) ?? null,
    updatedAt: doc['updatedAt'] as Date,
    appTag: (doc['appTag'] as string) ?? null,
    meta: (doc['meta'] as Record<string, unknown>) ?? {},
  };
}

export async function initMarker(
  db: Db,
  destination: { readonly storageHash: string; readonly profileHash: string },
): Promise<void> {
  const cmd = new RawInsertOneCommand(COLLECTION, {
    _id: MARKER_ID,
    storageHash: destination.storageHash,
    profileHash: destination.profileHash,
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(),
    appTag: null,
    meta: {},
  });
  await executeInsertOne(db, cmd);
}

export async function updateMarker(
  db: Db,
  expectedFrom: string,
  destination: { readonly storageHash: string; readonly profileHash: string },
): Promise<boolean> {
  const cmd = new RawFindOneAndUpdateCommand(
    COLLECTION,
    { _id: MARKER_ID, storageHash: expectedFrom },
    {
      $set: {
        storageHash: destination.storageHash,
        profileHash: destination.profileHash,
        updatedAt: new Date(),
      },
    },
    false,
  );
  const result = await executeFindOneAndUpdate(db, cmd);
  return result !== null;
}

export async function writeLedgerEntry(
  db: Db,
  entry: { readonly edgeId: string; readonly from: string; readonly to: string },
): Promise<void> {
  const cmd = new RawInsertOneCommand(COLLECTION, {
    type: 'ledger',
    edgeId: entry.edgeId,
    from: entry.from,
    to: entry.to,
    appliedAt: new Date(),
  });
  await executeInsertOne(db, cmd);
}
