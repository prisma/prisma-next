import type { ContractMarkerRecord, LedgerEntryRecord } from '@prisma-next/contract/types';
import { parseMarkerRowSafely, withMarkerReadErrorHandling } from '@prisma-next/errors/execution';
import { ledgerOriginFromStored } from '@prisma-next/migration-tools/ledger-origin';
import {
  RawAggregateCommand,
  RawFindOneAndUpdateCommand,
  RawInsertOneCommand,
} from '@prisma-next/mongo-query-ast/execution';
import { type } from 'arktype';
import type { Db, Document, UpdateFilter } from 'mongodb';

const COLLECTION = '_prisma_migrations';
const MONGO_MARKER_COLLECTION = `_prisma_migrations marker documents in ${COLLECTION}`;
const MONGO_LEDGER_COLLECTION = `_prisma_migrations ledger documents in ${COLLECTION}`;

/**
 * Marker doc shape.
 *
 * Same fields as the SQL marker row but camelCase + Mongo-native types:
 * `Date` is BSON-hydrated, `meta` is a native object (not JSON-stringified),
 * `_id` and any extension fields are tolerated. `invariants?` is optional —
 * absent reads as `[]` (schemaless default); present-but-malformed throws.
 *
 * `space` is required: every marker doc is keyed by its space id (`_id`)
 * and stamped with a matching `space` field for partitioned reads.
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

function parseMongoMarkerDocSafely(doc: unknown, space: string): ContractMarkerRecord {
  return parseMarkerRowSafely(doc, parseMongoMarkerDoc, {
    space,
    markerLocation: MONGO_MARKER_COLLECTION,
  });
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
 * `null` if no marker has been written for that space yet. Each space
 * owns one row keyed by `_id: <space>` — see ADR 212 for the per-space
 * mechanism this enables.
 */
export async function readMarker(db: Db, space: string): Promise<ContractMarkerRecord | null> {
  const markerContext = { space, markerLocation: MONGO_MARKER_COLLECTION };
  const docs = await withMarkerReadErrorHandling(
    () =>
      executeAggregate(
        db,
        new RawAggregateCommand(COLLECTION, [{ $match: { _id: space, space } }, { $limit: 1 }]),
      ),
    markerContext,
  );
  const doc = docs[0];
  if (!doc) return null;
  return parseMongoMarkerDocSafely(doc, space);
}

/**
 * Reads every marker doc in the collection (one per contract space)
 * and returns them keyed by `space`. Used by the per-space verifier
 * to detect marker-vs-on-disk drift and orphan marker rows. Returns
 * an empty map when no marker docs have been written yet.
 *
 * Marker docs are keyed by `_id: <space>` (string); ledger entries
 * live in the same collection but use a driver-generated `ObjectId`
 * `_id` plus `type: 'ledger'`. The filter selects string-keyed docs
 * with a `space` field, which excludes ledger entries by construction.
 */
export async function readAllMarkers(db: Db): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
  const markerContext = { space: 'app', markerLocation: MONGO_MARKER_COLLECTION };
  const docs = await withMarkerReadErrorHandling(
    () =>
      executeAggregate(
        db,
        new RawAggregateCommand(COLLECTION, [
          {
            $match: {
              _id: { $type: 'string' },
              space: { $type: 'string' },
              $expr: { $eq: ['$_id', '$space'] },
            },
          },
        ]),
      ),
    markerContext,
  );
  const out = new Map<string, ContractMarkerRecord>();
  for (const doc of docs) {
    const space = doc['space'];
    /* v8 ignore next -- @preserve type-narrowing guard: the $match stage above filters on `space: { $type: 'string' }`, so this branch is unreachable at runtime. The check exists so the `out.set(space, ...)` call below can accept `string`. */
    if (typeof space !== 'string') continue;
    out.set(space, parseMongoMarkerDocSafely(doc, space));
  }
  return out;
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
    { _id: space, space, storageHash: expectedFrom },
    update,
    false,
  );
  const result = await executeFindOneAndUpdate(db, cmd);
  return result !== null;
}

/**
 * Reads per-migration ledger entries in apply order. When `space` is omitted,
 * returns rows for every space. Returns `[]` when no ledger documents exist yet.
 */
export async function readLedger(db: Db, space?: string): Promise<readonly LedgerEntryRecord[]> {
  const ledgerContext = { space: space ?? '*', markerLocation: MONGO_LEDGER_COLLECTION };
  const matchStage: Record<string, unknown> = { type: 'ledger' };
  if (space !== undefined) {
    matchStage['space'] = space;
  }
  const docs = await withMarkerReadErrorHandling(
    () =>
      executeAggregate(
        db,
        new RawAggregateCommand(COLLECTION, [{ $match: matchStage }, { $sort: { _id: 1 } }]),
      ),
    ledgerContext,
  );

  const entries: LedgerEntryRecord[] = [];
  for (const doc of docs) {
    const migrationName = doc['migrationName'];
    const migrationHash = doc['migrationHash'];
    const from = doc['from'];
    const to = doc['to'];
    const docSpace = doc['space'];
    if (typeof migrationName !== 'string' || typeof migrationHash !== 'string') {
      continue;
    }
    if (typeof from !== 'string' || typeof to !== 'string') {
      continue;
    }
    if (typeof docSpace !== 'string') {
      continue;
    }
    const appliedAt = doc['appliedAt'];
    const appliedAtDate =
      appliedAt instanceof Date
        ? appliedAt
        : appliedAt !== undefined
          ? new Date(String(appliedAt))
          : new Date();
    const operations = doc['operations'];
    const opList = Array.isArray(operations) ? operations : [];
    entries.push({
      space: docSpace,
      migrationName,
      migrationHash,
      from: ledgerOriginFromStored(from),
      to,
      appliedAt: appliedAtDate,
      operationCount: opList.length,
    });
  }
  return entries;
}

export async function writeLedgerEntry(
  db: Db,
  space: string,
  entry: {
    readonly edgeId: string;
    readonly from: string;
    readonly to: string;
    readonly migrationName: string;
    readonly migrationHash: string;
    readonly operations: readonly unknown[];
  },
): Promise<void> {
  const cmd = new RawInsertOneCommand(COLLECTION, {
    type: 'ledger',
    space,
    edgeId: entry.edgeId,
    from: entry.from,
    to: entry.to,
    migrationName: entry.migrationName,
    migrationHash: entry.migrationHash,
    operations: entry.operations,
    appliedAt: new Date(),
  });
  await executeInsertOne(db, cmd);
}
