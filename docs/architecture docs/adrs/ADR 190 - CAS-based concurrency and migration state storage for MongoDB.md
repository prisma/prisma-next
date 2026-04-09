# ADR 190 — CAS-based concurrency and migration state storage for MongoDB

## At a glance

The migration runner uses compare-and-swap on a marker document for concurrency safety, and stores both the marker and migration ledger in a single `_prisma_migrations` collection. If two runners race, one wins and the other gets a clean hash-mismatch error.

```
_prisma_migrations
├── { _id: "marker", storageHash: "sha256:v2", profileHash: "sha256:p2", updatedAt: ..., meta: {} }
├── { type: "ledger", edgeId: "→sha256:v1", from: "", to: "sha256:v1", appliedAt: ... }
├── { type: "ledger", edgeId: "sha256:v1→sha256:v2", from: "sha256:v1", to: "sha256:v2", appliedAt: ... }
└── ...
```

## Context

When the runner applies a migration, it needs to:

1. **Verify** the database is at the expected state before mutating (the plan's origin hash matches the marker).
2. **Record** the new state after mutating (update the marker to the destination hash).
3. **Handle races** where two runners attempt `migration apply` simultaneously.

Postgres solves (3) with advisory locks (`pg_advisory_lock`) — the runner acquires a lock before applying and holds it until the marker is updated. MongoDB has no native advisory lock primitive.

## Decision

### The marker

A singleton document that records which contract the database currently satisfies:

```ts
// _id: "marker" — singleton, one per database
{
  _id: "marker",
  storageHash: "sha256:abc",   // current contract's storage hash
  profileHash: "sha256:def",   // current contract's profile hash
  contractJson: null,          // optional full contract (future)
  canonicalVersion: null,      // canonicalization version (future)
  updatedAt: ISODate("..."),
  appTag: null,                // optional deployment context
  meta: {}                     // reserved for forward-compatible fields
}
```

This is the Mongo implementation of the marker described in [ADR 021 (Contract Marker Storage)](ADR%20021%20-%20Contract%20Marker%20Storage.md). The document shape maps directly to the framework's `ContractMarkerRecord` interface.

Three operations on the marker:

**Read** — check if a marker exists and what hash the database is at:

```ts
async function readMarker(db: Db): Promise<ContractMarkerRecord | null> {
  const doc = await db
    .collection('_prisma_migrations')
    .findOne({ _id: 'marker' });
  if (!doc) return null;
  return {
    storageHash: doc.storageHash,
    profileHash: doc.profileHash,
    updatedAt: doc.updatedAt,
    // ... remaining fields
  };
}
```

**Initialize** — first migration on a fresh database:

```ts
async function initMarker(
  db: Db,
  destination: { storageHash: string; profileHash: string },
): Promise<void> {
  await db.collection('_prisma_migrations').insertOne({
    _id: 'marker',
    storageHash: destination.storageHash,
    profileHash: destination.profileHash,
    updatedAt: new Date(),
    meta: {},
  });
}
```

**Update (compare-and-swap)** — the concurrency primitive:

```ts
async function updateMarker(
  db: Db,
  expectedFrom: string,
  destination: { storageHash: string; profileHash: string },
): Promise<boolean> {
  const result = await db.collection('_prisma_migrations').findOneAndUpdate(
    { _id: 'marker', storageHash: expectedFrom },
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
```

The `findOneAndUpdate` filter includes both `_id: 'marker'` and `storageHash: expectedFrom`. If another process updated the marker between our read and our write, the filter doesn't match, `findOneAndUpdate` returns `null`, and we know the CAS failed. The runner reports `MARKER_ORIGIN_MISMATCH` — a clean, deterministic error.

### The ledger

Append-only documents recording each applied migration edge:

```ts
async function writeLedgerEntry(
  db: Db,
  entry: { edgeId: string; from: string; to: string },
): Promise<void> {
  await db.collection('_prisma_migrations').insertOne({
    type: 'ledger',
    edgeId: entry.edgeId,
    from: entry.from,
    to: entry.to,
    appliedAt: new Date(),
  });
}
```

The ledger is for audit and history — which migrations were applied, in what order, and when. It is not used for correctness decisions. The marker is authoritative for "where is the database now?"

### Single collection

Both the marker and ledger live in `_prisma_migrations`. The marker is identified by `_id: 'marker'`; ledger entries are identified by auto-generated `_id` plus `type: 'ledger'`.

One collection to create, one to query (`db._prisma_migrations.find()`), one to reason about during setup and introspection. This mirrors the single-table pattern Postgres uses for its migration metadata.

## Runner execution flow

The runner's execution sequence integrates the marker with the three-phase operation loop from [ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md):

```
1. Deserialize operations from plan JSON (rehydrate AST nodes)
2. Enforce policy (reject operations with disallowed classes)
3. Read marker from _prisma_migrations
4. Validate marker matches plan origin hash
   └─ mismatch → MARKER_ORIGIN_MISMATCH
5. For each operation: precheck → execute → postcheck
   (idempotency probe: if postchecks already pass, skip)
6. Update marker via CAS
   └─ CAS failure → another runner applied concurrently
7. Write ledger entry
```

Steps 1–5 are the same for every target. Steps 6–7 are the Mongo-specific state persistence.

## Alternatives considered

### Advisory lock simulation

We could simulate Postgres-style advisory locks with a lock document and a TTL:

```ts
// acquire: insert a lock doc with an expiry
await db.collection('_prisma_locks').insertOne({
  _id: 'migration',
  acquiredAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
});
// release: delete the lock doc
```

This adds significant complexity: lock expiry, stale lock cleanup, retry loops with backoff, and a second collection to manage. All of this for a scenario — concurrent `migration apply` — that is rare in practice and easily detected. CAS on the marker is simpler: one atomic operation, no TTL, no cleanup, no retry loop. The losing runner gets a clean error.

### Separate marker and ledger collections

We could split `_prisma_migrations` into `_prisma_marker` and `_prisma_ledger`. This doubles the setup (two collections to create, two to query, two to reason about) with no meaningful benefit. The marker is one document; the ledger is a modest number of append-only documents. They coexist without interference.

### Retry on CAS failure

We could automatically retry the migration when CAS fails, on the assumption that the other runner applied the same plan. We chose not to because:

- The plans may be different (two developers applying different migrations).
- Silent retry hides the fact that a race occurred, which is operationally important to know.
- Concurrent applies are rare enough that a clean error with a "retry manually" message is the right UX.
