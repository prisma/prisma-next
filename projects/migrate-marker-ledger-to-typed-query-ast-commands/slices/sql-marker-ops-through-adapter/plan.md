# Slice `sql-marker-ops-through-adapter` — Dispatch plan

**Slice spec:** `./spec.md`

> Full dispatch decomposition is authored at slice pickup (this slice builds on `ddl-in-query-ast`, which must land first). Sketch only below; refine via `drive-plan-slice` when picked up.

### Sketch (refine at pickup)

1. **`SqlControlAdapter` write SPI** — add `initMarker` / `updateMarker` / `writeLedgerEntry`, building query-AST nodes via the contract-free constructors and lowering through `adapter.lower()`. Marker DML value codecs attached at the value site.
2. **Invariant-merge convergence** — `updateMarker` computes the unioned, deduped invariant set (under the existing migration txn + advisory lock) and emits a plain parameterized `UPDATE`; SQLite stops overwriting. Test pins both dialects.
3. **Read + parser consolidation** — collapse the runtime reader, family `readMarker`, and SQLite runner's private read into one SPI read; one `parseContractMarkerRow`.
4. **Remove the raw-SQL write builders** — delete `buildMergeMarkerStatements` / `writeContractMarker` / `buildWriteMarkerStatements`; migrate call sites; upsert collapses to `INSERT … ON CONFLICT … DO UPDATE`.

_Sequencing note: 1 before 2 (merge policy lives on `updateMarker`); 3 and 4 can follow once writes route through the SPI._
