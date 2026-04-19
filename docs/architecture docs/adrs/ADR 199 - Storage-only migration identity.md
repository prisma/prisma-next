# ADR 199 — Storage-only migration identity

**Amends:** [ADR 169 §3 — Content-addressed migration identity](ADR%20169%20-%20On-disk%20migration%20persistence.md)

## At a glance

A team has an attested migration `002-add-email-index`. Its manifest records `from`, `to` (storage hashes), `ops`, and the full `fromContract` / `toContract` JSON. Its `migrationId` was computed from all of these inputs.

A developer then renames an operation in the contract — say, `findUserByEmail` becomes `getUserByEmail`. No columns change, no indexes change, nothing about the physical database changes. But the canonicalized `toContract` is now different, so `computeMigrationId` returns a new hash. `migration verify` fails with `mismatch`. The developer must re-attest a migration whose ops are byte-for-byte identical.

This is wrong. The migration doesn't care about operation names. It cares about storage.

## Decision

`migrationId` is computed from `(strippedManifest, ops)` only. The full `fromContract`, `toContract`, and `hints` objects are excluded from the hash.

```ts
export function computeMigrationId(manifest: MigrationManifest, ops: MigrationOps): string {
  const {
    migrationId: _migrationId,
    signature: _signature,
    fromContract: _fromContract,
    toContract: _toContract,
    hints: _hints,
    ...strippedMeta
  } = manifest;

  const canonicalManifest = canonicalizeJson(strippedMeta);
  const canonicalOps = canonicalizeJson(ops);

  const partHashes = [canonicalManifest, canonicalOps].map(sha256Hex);
  const hash = sha256Hex(canonicalizeJson(partHashes));

  return `sha256:${hash}`;
}
```

`strippedMeta` contains `from`, `to`, `kind`, `labels`, `authorship?`, `createdAt`. The `from` and `to` fields are storage hashes — the same storage-projection commitment that ADR 004 defines. They pin the migration to its bookends: which physical schema it expects, and which physical schema it produces. Together with `ops`, they fully describe what the migration does to the database. Everything else is metadata *about* the migration, not part of its physical identity.

### What stays on disk

`fromContract`, `toContract`, and `hints` remain in `migration.json`. They are consumed by `migration plan` (to reconstruct the "from" schema for the next diff), `migration apply` (for display and verification), and the transitional `migration emit` command (to regenerate ops; see [ADR 193](ADR%20193%20-%20Class-flow%20as%20the%20canonical%20migration%20authoring%20strategy.md)). They're context for tooling, not inputs to identity.

### Why `hints` is excluded

`hints` carries `used`, `applied`, `plannerVersion`, and `planningStrategy` — metadata about how the migration was planned, not what it does. Stripping `hints` from the hash means a future cleanup or reshaping of these fields (they are currently written as empty arrays in some cases and read by nothing) doesn't invalidate existing `migrationId` values.

## Consequence

Non-storage contract edits — operation renames, docstring changes, codec metadata — no longer invalidate `migrationId`. A developer can evolve the contract's domain surface freely between planning cycles without triggering re-attestation of existing migrations.

Storage-affecting edits — changes to `from`, `to`, or `ops` — still produce a different `migrationId`, as they should. The migration's physical identity tracks its physical effect.

## Alternatives considered

### Keep full contracts in the hash (status quo ante)

ADR 169 §3 included canonicalized `fromContract` and `toContract` in the hash. The rationale was that migration identity should capture the full context the planner used. We chose to narrow because:

- The `from`/`to` storage hashes already pin the migration to its contract bookends. Adding the full contract objects is redundant for identity and actively harmful for stability.
- Migrations are storage artifacts (ADR 001, ADR 004). Their identity should reflect what they do to storage, not the shape of the contract's domain layer at planning time.
- The practical cost is high: any non-storage contract edit invalidates all downstream `migrationId` values, forcing re-attestation across the migration chain.

### Hash contracts but strip non-storage fields first

Instead of dropping contracts entirely, we could have projected each contract down to its storage-relevant fields before hashing. This was rejected because the `from`/`to` storage hashes already *are* that projection — they are the canonical storage fingerprint defined by ADR 004. Duplicating the projection inside `computeMigrationId` would be redundant and would couple the migration identity computation to the contract's internal field structure.

## References

- [ADR 001 — Migrations as Edges](ADR%20001%20-%20Migrations%20as%20Edges.md)
- [ADR 004 — Storage Hash vs Profile Hash](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md)
- [ADR 028 — Migration Structure & Operations](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md)
- [ADR 169 — On-disk migration persistence](ADR%20169%20-%20On-disk%20migration%20persistence.md) (§3 amended)
- ADR 192 — ops.json is the migration contract (concurrent)
