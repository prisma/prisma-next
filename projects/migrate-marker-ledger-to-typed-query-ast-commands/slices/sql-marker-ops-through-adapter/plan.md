# Slice `sql-marker-ops-through-adapter` — Dispatch plan

**Slice spec:** `./spec.md`

Refined at pickup (2026-06-02), after `ddl-in-query-ast` (TML-2761, PR #672) merged to `main`. The DDL surface, the adapter DDL-lowering seam, the contract-free constructors, and marker/ledger **bootstrap** DDL through the adapter are all in place. This slice adds the marker/ledger **DML** and consolidates it.

## Pinned decisions (slice open questions, settled at pickup)

- **OQ1 — Upsert.** Collapse the marker insert/update branching to a single `INSERT … ON CONFLICT (space) DO UPDATE SET …` on **both** Postgres and SQLite (both support UPSERT). No capability gate needed for these two targets; if a future target lacks UPSERT, gate then.
- **OQ2 — "Single SPI" altitude.** Keep the SPI **per-family** (`SqlControlAdapter`). Do **not** hoist a shared cross-family interface unless it falls out for free; the symmetry requirement (matching `MongoControlAdapter`'s method shape) is satisfied by parallel per-family interfaces, not a shared base.
- **OQ3 (project-level) — contract-free DML builder is D1 work.** Slice 1 shipped only the contract-free *DDL* constructors (`col`/`lit`/`fn`/`createTable`/`createSchema`). The contract-free *DML* builder (insert / upsert / update covering exactly the marker/ledger needs) lands in **D1** as enabling work — it is a Project-DoD item, not scope expansion.
- **`updated_at` clock source — preserve DB-side time.** The marker/ledger writes keep emitting the database-side time function (`now()` / `datetime('now')`), expressed as a typed value expression (`RawExpr`), **not** an app-server `Date` param. Switching the clock source would be a wire-semantics change the project spec fences off. (Decided at D1 R1 over the implementer's "mirror Mongo `new Date()`" instinct.)

These are documented degrees-of-freedom from the slice/project spec; pinned here so no dispatch assumes them silently.

## Dispatches (deliver in order)

### D1 — enabling DML surface + `SqlControlAdapter` marker/ledger **write SPI**
- **Outcome:** `SqlControlAdapter` exposes `initMarker` / `updateMarker` / `writeLedgerEntry` (symmetric with `MongoControlAdapter`), each building query-AST DML and lowering through `adapter.lower()` → driver. Marker DML value codecs (`meta`/`contract_json` JSON, `invariants` array, `updated_at` timestamp) attached explicitly at the value site (target-specific). New methods are wired but old raw-string write builders may still exist (cut-over is D4).
- **Enabling surface (resized at D1 R1 — see `reviews/code-review.md § D1 R1`):** D1 also builds the surfaces this requires that slice 1 didn't ship:
  - **Contract-free DML builder** (insert / upsert / update for the marker/ledger needs), beside the AST (OQ3).
  - **`TableSource.schema?`** on the core relational-core AST + both renderers (PG qualifies `schema.name`; SQLite asserts schema absent) — to express fixed control-plane tables (`prisma_contract.marker`) contract-free.
  - **Postgres `text[]` array codec** for `invariants`.
  - **`updated_at`** stays DB-side time via `RawExpr` (no app-side `Date`).
- **Builds on:** slice 1's contract-free DDL constructors + `adapter.lower()` path (bootstrap DDL already routes through it).
- **Hands to:** the write-SPI surface that D2 (merge policy on `updateMarker`) and D4 (call-site cut-over) consume; the contract-free DML builder + `TableSource.schema` that later dispatches reuse.
- **Focus:** enabling surface + the three write methods + value-codec attachment, proven by unit tests pinning the lowered SQL on both dialects. Do **not** delete the old builders or migrate their call sites (D4). `INSERT … ON CONFLICT (space) DO UPDATE` upsert shape lands here per OQ1. Suggested 2-commit split: (1) enabling AST/builder/codec; (2) SQL write SPI + tests.

### D2 — Invariant-merge convergence
- **Outcome:** `updateMarker` computes the unioned, deduped invariant set and emits a plain parameterized `UPDATE` (Postgres keeps merge-dedupe; **SQLite stops overwriting** — both accumulate-dedupe). Runs under the existing migration txn + advisory lock (no new locking). A test pins accumulate-dedupe for **both** Postgres and SQLite. The PR body states the observable SQLite behaviour change.
- **Builds on:** D1's `updateMarker`.
- **Hands to:** the converged merge policy that the cut-over (D4) routes all advance call sites onto.
- **Focus:** merge policy on the SPI method only. Operator-confirmed behaviour change; surface it in the slice's PR description.
- **Mechanism:** compute the union+dedupe in the adapter (TS), uniform across dialects — this is precisely why SQLite (JSON-as-`TEXT`, no SQL array ops) can stop overwriting.
- **Current-invariants source — DECIDED (D2 R1 fork): read internally (Option B).** `updateMarker` reads the current marker under the existing txn+advisory lock (reusing the `readMarker` SPI path D3 consolidates), merges in TS, writes back. **Rationale:** keeps the SQL `updateMarker` signature byte-identical to Mongo's (preserves the "symmetric SPI shape" project-DoD item + slice DC-4, verified PASS in D1) and hides the dialect's merge mechanism behind a uniform interface, as the adapter pattern intends. The rejected Option A (thread current invariants in as a param) leaks the storage difference into the signature. The extra read is one `SELECT` during a migration advance — negligible; reusing `readMarker` means no new decode surface.

### D3 — Read + parser consolidation
- **Outcome:** the runtime reader, the family `readMarker`, and the SQLite runner's private read collapse into **one** canonical read + **one** parser; the two `parseContractMarkerRow` copies become one. `MarkerReadResult` `no-table`/`absent`/`present` semantics unchanged.
- **Builds on:** the SPI read surface (existing `readMarker`/`readAllMarkers` + D1's home).
- **Hands to:** a single read home for the cut-over.
- **Focus:** read-path + parser de-duplication. No behaviour change to read semantics.
- **Return-type fork — DECIDED (D3 R1): Option 1 (one shared read helper, two thin typed projections).** The runtime reader needs the 3-way `MarkerReadResult`; the control SPI `readMarker` deliberately returns `ContractMarkerRecord | null`. Extract **one** canonical read (probe → select → per-dialect decode → the one parser → `MarkerReadResult`); the runtime reader returns it verbatim, the control `readMarker` projects `present→record / else→null` (**signature unchanged**). **Rationale:** delivers the "one read home + one parser" goal without forcing the control SPI to carry a 3-way result its consumers don't want; preserves `MarkerReadResult` (DoD) **and** SQL↔Mongo `readMarker` `| null` symmetry (project-DoD); zero ripple into D2's `updateMarker`, the runner write flow, or the CLI (Option 2's cost). Canonical parser = the `verify.ts` superset (fixes a latent runtime SQLite `contract_json` under-parse; no test pins the old behaviour). The shared helper's home respects layering (`pnpm lint:deps`) — surface if layering forces an awkward placement.

### D4 — Remove the raw-SQL write builders + cut over call sites
- **Outcome:** `buildMergeMarkerStatements`, `writeContractMarker`, and `buildWriteMarkerStatements` (raw strings in `statement-builders.ts` / `sql-marker.ts`) are **removed** (not wrapped); every in-scope marker/ledger write call site routes through the D1 SPI. `git grep` shows zero `driver.query(rawMarkerSql)` outside adapter lowering for in-scope ops.
- **Builds on:** D1 (write SPI) + D2 (merge policy) + D3 (read home).
- **Hands to:** slice DoD — a fully adapter-routed SQL marker/ledger path.
- **Focus:** deletion + call-site migration + upsert collapse. Cross-package gate: workspace-wide test + `git grep` for the removed symbols across `test/`, `examples/`, sibling packages.
- **Reconcile the column set at cut-over (D1 R1 review item):** the legacy PG merge `update` (`statement-builders.ts:128`) rewrites the **full** marker row; the new `updateMarker` touches only `core_hash`/`profile_hash`/`updated_at`/`invariants`. At cut-over, confirm the advance path doesn't depend on the legacy write also refreshing `meta`/`contract_json` (or fold those into `updateMarker`/`initMarker` as appropriate) — don't silently drop columns the old path wrote.

_Sequencing: D1 → D2 (merge policy lives on `updateMarker`); D3 independent of D2 (can interleave); D4 last (depends on D1–D3). Each dispatch is one reviewable unit; **may fan out** at dispatch time if a review can't hold it._

## Validation gate (all dispatches)

`pnpm typecheck` (full) · package-scoped `pnpm test` for `@prisma-next/family-sql` + `@prisma-next/adapter-postgres` + `@prisma-next/adapter-sqlite` (+ any touched target/runtime package) · `pnpm fixtures:check` (byte-identical) · biome on changed files. D4 additionally runs the workspace-wide test command + a `git grep` for the removed symbols.
