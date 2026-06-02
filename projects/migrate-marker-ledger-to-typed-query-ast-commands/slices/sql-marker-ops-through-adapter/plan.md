# Slice `sql-marker-ops-through-adapter` — Dispatch plan

**Slice spec:** `./spec.md`

Refined at pickup (2026-06-02), after `ddl-in-query-ast` (TML-2761, PR #672) merged to `main`. The DDL surface, the adapter DDL-lowering seam, the contract-free constructors, and marker/ledger **bootstrap** DDL through the adapter are all in place. This slice adds the marker/ledger **DML** and consolidates it.

## Pinned decisions (slice open questions, settled at pickup)

- **OQ1 — Upsert.** Collapse the marker insert/update branching to a single `INSERT … ON CONFLICT (space) DO UPDATE SET …` on **both** Postgres and SQLite (both support UPSERT). No capability gate needed for these two targets; if a future target lacks UPSERT, gate then.
- **OQ2 — "Single SPI" altitude.** Keep the SPI **per-family** (`SqlControlAdapter`). Do **not** hoist a shared cross-family interface unless it falls out for free; the symmetry requirement (matching `MongoControlAdapter`'s method shape) is satisfied by parallel per-family interfaces, not a shared base.

These are documented degrees-of-freedom from the slice spec; pinned here so no dispatch assumes them silently.

## Dispatches (deliver in order)

### D1 — `SqlControlAdapter` marker/ledger **write SPI**
- **Outcome:** `SqlControlAdapter` exposes `initMarker` / `updateMarker` / `writeLedgerEntry` (symmetric with `MongoControlAdapter`), each building query-AST DML via the slice-1 contract-free constructors and lowering through `adapter.lower()` → driver. Marker DML value codecs (`meta` JSON, `invariants` array, `updated_at` timestamp) attached explicitly at the value site (target-specific). New methods are wired but old raw-string write builders may still exist (cut-over is D4).
- **Builds on:** slice 1's contract-free constructors + `adapter.lower()` path (bootstrap DDL already routes through it).
- **Hands to:** the write-SPI surface that D2 (merge policy on `updateMarker`) and D4 (call-site cut-over) consume.
- **Focus:** the write methods + value-codec attachment, proven by unit tests that the lowered SQL is correct on both dialects. Do **not** yet delete the old builders or migrate their call sites (D4). `INSERT … ON CONFLICT` upsert shape lands here for `initMarker`/`updateMarker` per OQ1.

### D2 — Invariant-merge convergence
- **Outcome:** `updateMarker` computes the unioned, deduped invariant set and emits a plain parameterized `UPDATE` (Postgres keeps merge-dedupe; **SQLite stops overwriting** — both accumulate-dedupe). Runs under the existing migration txn + advisory lock (no new locking). A test pins accumulate-dedupe for **both** Postgres and SQLite. The PR body states the observable SQLite behaviour change.
- **Builds on:** D1's `updateMarker`.
- **Hands to:** the converged merge policy that the cut-over (D4) routes all advance call sites onto.
- **Focus:** merge policy on the SPI method only. Operator-confirmed behaviour change; surface it in the slice's PR description.

### D3 — Read + parser consolidation
- **Outcome:** the runtime reader, the family `readMarker`, and the SQLite runner's private read collapse into **one** SPI read; the two `parseContractMarkerRow` copies become one. `MarkerReadResult` `no-table`/`absent`/`present` semantics unchanged.
- **Builds on:** the SPI read surface (existing `readMarker`/`readAllMarkers` + D1's home).
- **Hands to:** a single read home for the cut-over.
- **Focus:** read-path + parser de-duplication. No behaviour change to read semantics.

### D4 — Remove the raw-SQL write builders + cut over call sites
- **Outcome:** `buildMergeMarkerStatements`, `writeContractMarker`, and `buildWriteMarkerStatements` (raw strings in `statement-builders.ts` / `sql-marker.ts`) are **removed** (not wrapped); every in-scope marker/ledger write call site routes through the D1 SPI. `git grep` shows zero `driver.query(rawMarkerSql)` outside adapter lowering for in-scope ops.
- **Builds on:** D1 (write SPI) + D2 (merge policy) + D3 (read home).
- **Hands to:** slice DoD — a fully adapter-routed SQL marker/ledger path.
- **Focus:** deletion + call-site migration + upsert collapse. Cross-package gate: workspace-wide test + `git grep` for the removed symbols across `test/`, `examples/`, sibling packages.

_Sequencing: D1 → D2 (merge policy lives on `updateMarker`); D3 independent of D2 (can interleave); D4 last (depends on D1–D3). Each dispatch is one reviewable unit; **may fan out** at dispatch time if a review can't hold it._

## Validation gate (all dispatches)

`pnpm typecheck` (full) · package-scoped `pnpm test` for `@prisma-next/family-sql` + `@prisma-next/adapter-postgres` + `@prisma-next/adapter-sqlite` (+ any touched target/runtime package) · `pnpm fixtures:check` (byte-identical) · biome on changed files. D4 additionally runs the workspace-wide test command + a `git grep` for the removed symbols.
