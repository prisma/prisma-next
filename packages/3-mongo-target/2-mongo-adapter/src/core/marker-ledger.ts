// TODO(TML-2253): Migrate to typed query AST commands (RawFindOneCommand, RawInsertOneCommand, etc.)
import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type { Db } from 'mongodb';

const COLLECTION = '_prisma_migrations';
const MARKER_ID = 'marker';

export async function readMarker(db: Db): Promise<ContractMarkerRecord | null> {
  const doc = await db
    .collection(COLLECTION)
    .findOne({ _id: MARKER_ID } as Record<string, unknown>);
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
  await db.collection(COLLECTION).insertOne({
    _id: MARKER_ID,
    storageHash: destination.storageHash,
    profileHash: destination.profileHash,
    contractJson: null,
    canonicalVersion: null,
    updatedAt: new Date(),
    appTag: null,
    meta: {},
  } as Record<string, unknown>);
}

export async function updateMarker(
  db: Db,
  expectedFrom: string,
  destination: { readonly storageHash: string; readonly profileHash: string },
): Promise<boolean> {
  const result = await db.collection(COLLECTION).findOneAndUpdate(
    { _id: MARKER_ID, storageHash: expectedFrom } as Record<string, unknown>,
    {
      $set: {
        storageHash: destination.storageHash,
        profileHash: destination.profileHash,
        updatedAt: new Date(),
      },
    },
    { upsert: false },
  );
  return result !== null;
}

export async function writeLedgerEntry(
  db: Db,
  entry: { readonly edgeId: string; readonly from: string; readonly to: string },
): Promise<void> {
  await db.collection(COLLECTION).insertOne({
    type: 'ledger',
    edgeId: entry.edgeId,
    from: entry.from,
    to: entry.to,
    appliedAt: new Date(),
  });
}
