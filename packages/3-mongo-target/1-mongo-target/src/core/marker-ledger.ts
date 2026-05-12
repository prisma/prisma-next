import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import {
  RawAggregateCommand,
  RawFindOneAndUpdateCommand,
  RawInsertOneCommand,
} from '@prisma-next/mongo-query-ast/execution';
import { type } from 'arktype';
import type { Db, Document, UpdateFilter } from 'mongodb';

const COLLECTION = '_prisma_migrations';

/**
 * `_id` value used by pre-port code that wrote a single marker doc
 * (no `space` field). Post-port code keys docs by their space id, so
 * this constant is referenced only by the legacy-shape upgrade path
 * inside {@link readMarker}. New writes never produce this `_id`.
 *
 * The legacy discriminator is `_id === LEGACY_MARKER_ID` AND the doc
 * has no `space` field — a hypothetical extension whose space id
 * happens to be `'marker'` would write `{_id: 'marker', space: 'marker'}`
 * and is correctly identified as canonical, not legacy.
 */
const LEGACY_MARKER_ID = 'marker';

/**
 * MongoDB duplicate-key error code (`E11000`). Surfaced by `insertOne`
 * when another connection has already inserted a doc with the same
 * `_id`. The legacy-upgrade path catches it as a benign "race lost"
 * signal: the other process finished the upgrade insert first, and
 * we proceed to the (idempotent) sweep step instead.
 */
const MONGO_DUPLICATE_KEY_CODE = 11000;

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
 *
 * For the app space (`'app'`), this also detects pre-port marker docs
 * keyed by `_id: 'marker'` (no `space` field) and upgrades them in
 * place to the canonical `{_id: 'app', space: 'app', ...}` shape. The
 * upgrade is idempotent and concurrent-safe: parallel readers all
 * converge to the canonical doc with the legacy doc swept. Partial
 * writes from a previous run (canonical inserted, legacy not yet
 * deleted) are detected on the next read and the sweep is retried.
 */
export async function readMarker(db: Db, space: string): Promise<ContractMarkerRecord | null> {
  if (space === APP_SPACE_ID) {
    return readAppMarker(db);
  }
  return readNonAppMarker(db, space);
}

async function readAppMarker(db: Db): Promise<ContractMarkerRecord | null> {
  const cmd = new RawAggregateCommand(COLLECTION, [
    { $match: { _id: { $in: [APP_SPACE_ID, LEGACY_MARKER_ID] } } },
  ]);
  const docs = await executeAggregate(db, cmd);
  const canonical = docs.find((d) => d['_id'] === APP_SPACE_ID);
  const legacyCandidate = docs.find((d) => d['_id'] === LEGACY_MARKER_ID);
  // A doc at `_id: 'marker'` is only treated as legacy when it lacks
  // the post-port `space` field. This preserves namespace headroom for
  // a hypothetical extension whose space id is `'marker'` — its doc
  // would carry `space: 'marker'` and would not be touched here.
  const legacy = legacyCandidate && legacyCandidate['space'] === undefined ? legacyCandidate : null;

  if (canonical && legacy) {
    // Mid-upgrade or partial-write recovery: canonical already exists,
    // sweep the leftover legacy doc and return canonical.
    await sweepLegacyAppMarker(db);
    return parseMongoMarkerDoc(canonical);
  }
  if (canonical) return parseMongoMarkerDoc(canonical);
  if (legacy) return upgradeLegacyAppMarker(db, legacy);
  return null;
}

async function readNonAppMarker(db: Db, space: string): Promise<ContractMarkerRecord | null> {
  const cmd = new RawAggregateCommand(COLLECTION, [{ $match: { _id: space } }, { $limit: 1 }]);
  const docs = await executeAggregate(db, cmd);
  const doc = docs[0];
  if (!doc) return null;
  // Defense-in-depth: a pre-port DB has a single doc at `_id: 'marker'`
  // with no `space` field. If a non-app caller's space id happens to
  // collide ('marker'), we must not parse the legacy doc as that
  // space's marker — return null and let the next app-space read
  // upgrade or sweep it.
  if (doc['space'] === undefined) return null;
  return parseMongoMarkerDoc(doc);
}

/**
 * Copies legacy fields into a canonical-shaped doc and writes it,
 * then sweeps the legacy doc. Both writes are idempotent under
 * concurrent execution: a `DuplicateKey` error from `insertOne`
 * means another process already finished the upgrade insert; we
 * fall through to the sweep, which is itself a no-op when the
 * legacy doc is already gone.
 */
async function upgradeLegacyAppMarker(db: Db, legacy: Document): Promise<ContractMarkerRecord> {
  const canonicalDoc: { _id: string; space: string; [key: string]: unknown } = {
    _id: APP_SPACE_ID,
    space: APP_SPACE_ID,
  };
  for (const field of LEGACY_PORTABLE_FIELDS) {
    if (legacy[field] !== undefined) canonicalDoc[field] = legacy[field];
  }
  // Validate the synthesised canonical doc before writing. If the
  // legacy doc carried malformed optional fields (e.g. invariants
  // that aren't a string array), surface the corruption error here
  // rather than persisting an invalid doc at the canonical id.
  const parsed = parseMongoMarkerDoc(canonicalDoc);

  try {
    await markerCollection(db).insertOne(canonicalDoc);
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    // Another connection inserted canonical first — fall through to
    // the sweep so the legacy doc is cleaned up regardless of which
    // racer wrote it.
  }
  await sweepLegacyAppMarker(db);
  return parsed;
}

async function sweepLegacyAppMarker(db: Db): Promise<void> {
  await markerCollection(db).deleteOne({
    _id: LEGACY_MARKER_ID,
    space: { $exists: false },
  });
}

/**
 * Marker docs use string `_id` values (the space id, or the legacy
 * `'marker'` literal). The driver's default collection type assumes
 * `ObjectId` for `_id`; widening here lets the legacy-upgrade path
 * filter and write by string id without casts at every call site.
 */
function markerCollection(db: Db) {
  return db.collection<{ _id: string; [key: string]: unknown }>(COLLECTION);
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: number }).code === MONGO_DUPLICATE_KEY_CODE
  );
}

/**
 * Fields that may be carried from a pre-port marker doc into the
 * canonical post-port doc. `_id` is omitted (legacy uses `'marker'`,
 * canonical uses the space id) and `space` is omitted (legacy lacks
 * it; canonical stamps it explicitly). Required fields (`storageHash`,
 * `profileHash`) are listed first; if either is missing the synthesised
 * doc fails canonical validation and the upgrade aborts cleanly.
 */
const LEGACY_PORTABLE_FIELDS = [
  'storageHash',
  'profileHash',
  'contractJson',
  'canonicalVersion',
  'updatedAt',
  'appTag',
  'meta',
  'invariants',
] as const;

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
