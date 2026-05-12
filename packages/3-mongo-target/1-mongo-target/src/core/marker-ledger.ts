import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import {
  RawAggregateCommand,
  RawFindOneAndUpdateCommand,
  RawInsertOneCommand,
} from '@prisma-next/mongo-query-ast/execution';
import { type } from 'arktype';
import type { Db, Document, UpdateFilter } from 'mongodb';

const COLLECTION = '_prisma_migrations';

/**
 * Same shape as the SQL marker row but camelCase + Mongo-native types:
 * `Date` is BSON-hydrated, `meta` is a native object (not JSON-stringified),
 * `_id` and any extension fields are tolerated. `invariants?` is optional —
 * absent reads as `[]` (schemaless default); present-but-malformed throws.
 *
 * `space` is required on the canonical post-port shape — every marker doc
 * is keyed by its space. Pre-port docs (`{_id: 'marker', ...}` with no
 * `space`) are upgraded by the legacy-shape detector before reaching this
 * parser; see {@link readMarker}'s caller-side upgrade pass (T1.2).
 */
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

function parseMongoMarkerDoc(doc: unknown): ContractMarkerRecord {
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

/**
 * Reads the marker document for the given contract space, or returns
 * `null` if no marker has been written for that space yet. The marker doc
 * is keyed by `_id: <space>` so each loaded contract space owns one row
 * — see ADR 212 for the per-space mechanism this enables.
 */
export async function readMarker(db: Db, space: string): Promise<ContractMarkerRecord | null> {
  const cmd = new RawAggregateCommand(COLLECTION, [{ $match: { _id: space } }, { $limit: 1 }]);
  const docs = await executeAggregate(db, cmd);
  const doc = docs[0];
  if (!doc) return null;
  return parseMongoMarkerDoc(doc);
}

export async function initMarker(
  db: Db,
  space: string,
  destination: {
    readonly storageHash: string;
    readonly profileHash: string;
    readonly invariants?: readonly string[];
  },
): Promise<void> {
  const cmd = new RawInsertOneCommand(COLLECTION, {
    _id: space,
    space,
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
 * Updates the marker doc for the given space atomically (CAS on
 * `expectedFrom`).
 *
 * `destination.invariants`:
 * - `undefined` → existing field left untouched.
 * - explicit value → merged into the existing field server-side via an
 *   aggregation pipeline (`$setUnion + $sortArray`), atomic at the
 *   document level. `[]` is a no-op merge.
 */
export async function updateMarker(
  db: Db,
  space: string,
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
    { _id: space, storageHash: expectedFrom },
    update,
    false,
  );
  const result = await executeFindOneAndUpdate(db, cmd);
  return result !== null;
}

/**
 * Appends a ledger entry for the given space. Ledger entries co-exist
 * with marker docs in the same collection; marker docs use `_id: <space>`
 * (string), ledger entries use `type: 'ledger'` plus a driver-generated
 * ObjectId. Reads partition the two by filter shape.
 *
 * The same `edgeId` may legitimately recur across different spaces (e.g.
 * a synthetic ∅→head edge on first apply), so the ledger key is
 * `(space, edgeId)` — the doc carries `space` for partitioned reads.
 */
export async function writeLedgerEntry(
  db: Db,
  space: string,
  entry: { readonly edgeId: string; readonly from: string; readonly to: string },
): Promise<void> {
  const cmd = new RawInsertOneCommand(COLLECTION, {
    type: 'ledger',
    space,
    edgeId: entry.edgeId,
    from: entry.from,
    to: entry.to,
    appliedAt: new Date(),
  });
  await executeInsertOne(db, cmd);
}
