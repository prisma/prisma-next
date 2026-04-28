import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import {
  RawAggregateCommand,
  RawFindOneAndUpdateCommand,
  RawInsertOneCommand,
} from '@prisma-next/mongo-query-ast/execution';
import type { Db, Document, UpdateFilter } from 'mongodb';

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
  // `cmd.update` is `Document | ReadonlyArray<Document>` per the AST. The
  // MongoDB driver's `findOneAndUpdate` accepts the same shape under the
  // type `UpdateFilter<T> | Document[]`. The driver's runtime path handles
  // both forms identically — pipelines (array) and update docs (object).
  // One cast to that union keeps the call single-arm.
  return db
    .collection(cmd.collection)
    .findOneAndUpdate(cmd.filter, cmd.update as UpdateFilter<Document> | Document[], {
      upsert: cmd.upsert,
    });
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
    invariants: (doc['invariants'] as readonly string[]) ?? [],
  };
}

export async function initMarker(
  db: Db,
  destination: {
    readonly storageHash: string;
    readonly profileHash: string;
    readonly invariants?: readonly string[];
  },
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
    invariants: destination.invariants ?? [],
  });
  await executeInsertOne(db, cmd);
}

/**
 * Updates the marker doc atomically (CAS on `expectedFrom`).
 *
 * `destination.invariants`:
 * - `undefined` → existing field left untouched. Sign and
 *   verify-database paths use this; they don't accumulate invariants.
 * - explicit value → merged into the existing field server-side via an
 *   aggregation pipeline (`$setUnion + $sortArray`), atomic at the
 *   document level. `[]` is a no-op merge. See §"Concurrency:
 *   server-side merge for invariants" in the routing spec.
 */
export async function updateMarker(
  db: Db,
  expectedFrom: string,
  destination: {
    readonly storageHash: string;
    readonly profileHash: string;
    readonly invariants?: readonly string[];
  },
): Promise<boolean> {
  const setBase: Record<string, unknown> = {
    storageHash: destination.storageHash,
    profileHash: destination.profileHash,
    updatedAt: new Date(),
  };
  // When invariants is supplied, use an aggregation pipeline so the
  // merge runs server-side against the doc's current value (atomic, no
  // read-then-write window). When omitted, a regular update doc keeps
  // the field untouched.
  const update: Document | Document[] =
    destination.invariants === undefined
      ? { $set: setBase }
      : [
          {
            $set: {
              ...setBase,
              invariants: {
                $sortArray: {
                  input: { $setUnion: [{ $ifNull: ['$invariants', []] }, destination.invariants] },
                  sortBy: 1,
                },
              },
            },
          },
        ];
  const cmd = new RawFindOneAndUpdateCommand(
    COLLECTION,
    { _id: MARKER_ID, storageHash: expectedFrom },
    update,
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
