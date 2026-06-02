# Slice: sql-marker-ops-through-adapter

_(In-project slice: parent project `projects/migrate-marker-ledger-to-typed-query-ast-commands/`. Outcome: all SQL marker/ledger DML runs through the adapter behind one control-adapter SPI, with invariant-merge converged.)_

> Builds on slice `ddl-in-query-ast`, which already lands the target-contributed DDL surface, the adapter DDL-lowering seam, the contract-free constructors, **and** marker/ledger *bootstrap* DDL through the adapter. This slice adds the marker/ledger **DML** (reads, writes, ledger append), consolidates it behind one SPI, and converges invariant-merge. It does **not** introduce DDL nodes — that's done.

## At a glance

Route every SQL marker/ledger read and write through `SqlControlAdapter` → `adapter.lower()` → driver, collapse the three divergent raw-SQL write builders and duplicate read/parse paths into one SPI home, and converge invariant-merge on accumulate-dedupe across Postgres and SQLite (fixing SQLite's wholesale overwrite).

## Chosen design

- **`SqlControlAdapter` grows write methods** symmetric with `MongoControlAdapter`: `initMarker` / `updateMarker` / `writeLedgerEntry`, alongside the existing `readMarker` / `readAllMarkers`. Each builds query-AST nodes (via the contract-free constructors from slice 1) and lowers them through `adapter.lower()`.
- **Reads collapse to one path.** The runtime reader, the family `readMarker`, and the SQLite runner's private read become one SPI read; the two `parseContractMarkerRow` copies become one.
- **Writes collapse to one path.** `buildMergeMarkerStatements`, `writeContractMarker`, and `buildWriteMarkerStatements` (raw strings across `statement-builders.ts` / `sql-marker.ts`) are removed; the upsert becomes a single `INSERT … ON CONFLICT (space) DO UPDATE SET …`.
- **Invariant-merge is a domain operation on `updateMarker`**, not an AST node. The runner already reads the current marker before the advance, and the advance runs under the migration txn + advisory lock, so `updateMarker` computes the unioned, deduped invariant set in the adapter and emits a plain parameterized `UPDATE`. SQLite stops overwriting — both dialects accumulate-dedupe.
- **Marker DML value codecs** (`meta` JSON, `invariants` array, `updated_at` timestamp) are attached explicitly at the value site (target-specific `pg/jsonb@1` / SQLite JSON-as-`TEXT`), preserving JS round-tripping without contract inference.

## Coherence rationale

One reviewer holds it: this slice migrates *all* SQL marker/ledger DML call sites onto the new SPI and removes the old raw-string builders in one move. Splitting reads from writes would leave a half-migrated marker path with two homes mid-stream.

## Scope

**In:** `SqlControlAdapter` write methods; read-path + parser consolidation; removal of the three raw-SQL write builders; upsert collapse; invariant-merge convergence (incl. the observable SQLite change); marker DML value-codec attachment.

**Out:** DDL nodes / bootstrap / contract-free constructors (slice 1, done); migration-planner DDL (slice `planner-ddl-adopts-ast`); Mongo (slice `mongo-marker-ledger-through-adapter`).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| SQLite invariant overwrite→merge | Intended behaviour change | Operator-confirmed; PR states it explicitly. |
| `meta`/`contract_json` JSON encoding skew | Fixed by value codecs | Today `sql-marker.ts` hand-`JSON.stringify`s `meta` but not `contract_json`; routing through codecs makes encode/decode uniform across dialects. |
| Marker read on absent table | Preserve tagged result | `MarkerReadResult` `no-table`/`absent`/`present` semantics unchanged. |

## Slice-specific done conditions

- [ ] Zero `driver.query(rawMarkerSql)` outside adapter lowering for in-scope SQL marker/ledger ops (`git grep` clean).
- [ ] The three raw-SQL write builders and the duplicate read/parse paths are removed, not wrapped.
- [ ] A test pins accumulate-dedupe invariant-merge for **both** Postgres and SQLite.
- [ ] `SqlControlAdapter` marker-write surface matches `MongoControlAdapter`'s shape.

## Open Questions

1. **Upsert capability gating.** Working position: `INSERT … ON CONFLICT` on both Postgres and SQLite (both support UPSERT); gate if a target lacks it.
2. **"Single SPI" altitude.** Working position: per-family `SqlControlAdapter`; hoist a shared cross-family shape only if it falls out cleanly.

## References

- Parent project: `projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`
- Design notes: `projects/migrate-marker-ledger-to-typed-query-ast-commands/design-notes.md`
- Sibling (dependency): slice `ddl-in-query-ast`.
- Linear issue: TML-2753
- ADRs: 021, 043, 190, 204, 212.
