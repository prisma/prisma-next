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

## Corrective dispatches (added 2026-06-03 after PR #712 review)

D1–D4 closed SATISFIED through the build loop but operator review caught three architectural mistakes. Lessons landed (see `../retros.md` + the referenced failure-mode entries). Corrective dispatches D5 + D6 land on the same branch; PR #712 stays open. The `sign()`+upsert race (3rd finding) was already corrected by the babysit at `5da812ac0` via a new `insertMarker` primitive (no further dispatch needed; retro lesson F19 is the durable output).

### D5 — Revert `TableSource.schema?`; introduce target-contributed `PostgresTableSource`

- **Outcome (property statement):** the generic SQL core (`packages/2-sql/4-lanes/relational-core`) carries no target-specific fields; Postgres schema-qualified DML reaches the renderer via a target-contributed `PostgresTableSource extends TableSource` subclass living in the postgres target package — mirroring Slice 1's `PostgresCreateTable` pattern that is the canonical shape for this kind of extension. **Mechanically:** remove `schema?: string` from core `TableSource`; remove `schema` from the generic contract-free `tableRef` / `insert` / `update` / `upsert` builders in `relational-core/src/contract-free/dml.ts`; add `PostgresTableSource` (frozen-class, extends core `TableSource`) and a postgres-specific contract-free constructor (e.g. `pgTableRef({ schema, name, alias? })`) under `@prisma-next/target-postgres/contract-free` (or matching sibling); update the postgres SQL renderer's `TableSource` visit to read `schema` off the postgres subclass via brand check; update `packages/3-targets/6-adapters/postgres/src/core/marker-ledger-writes.ts` to construct schema-qualified marker tables via the new postgres-specific builder. SQLite is unaffected (its marker tables aren't schema-qualified). The PG `text[]` codec and `RawExpr` work from D1 stay.
- **Builds on:** D1's contract-free DML builder shape (generic factories) and Slice 1's `PostgresCreateTable` subclass pattern (the reference to mirror).
- **Hands to:** a target-agnostic generic core + a postgres-specific schema-qualified surface that's reachable only through the postgres target package.
- **Focus:** the layering fix. Same call-graph for marker writes; only the construction point moves from "core builder with schema arg" to "postgres-package builder that produces a postgres subclass". No semantic change in lowered SQL — `pnpm fixtures:check` must stay byte-identical; the marker write unit tests in `marker-ledger-writes.test.ts` must pin the same lowered SQL strings.
- **Composer constraints reminder:** pattern-clone from `PostgresCreateTable` and its contract-free factory in the postgres package — that's the reference. Do not introduce a `TableSourceVisitor` or any new dispatch mechanism; the renderer already has the visit hook, only the brand check changes. No drive-by refactors of unrelated core or postgres files.
- **Stop conditions specific to D5:** if implementer finds that reading `schema` off a postgres subclass requires extending the core `TableSource` visitor interface itself (i.e. the core renderer would need a `visitPostgresTableSource` slot), HALT and surface — the right answer is dispatch-double, not a wider core interface. (See **F16** in failure-modes.md: any self-acknowledged-violation comment in the diff is a must-fix; do not ship with one.)

### D6 — Read path adopt-adapter-owned shape; delete `MarkerStatement` / `MarkerReadShape` / `MarkerReadQueryable` / `readMarkerResult`

- **Outcome (property statement):** each adapter owns `readMarker(driver, space)` end-to-end inside its own package; `family-sql/verify.ts` calls `adapter.readMarker(driver, APP_SPACE_ID)` and consumes a `MarkerReadResult` — the family layer is unaware of probes, SQL fragments, row decoders, or any other implementation detail. The only shared piece is `parseContractMarkerRow` (a pure parser over the typed row shape). **Mechanically:** delete `MarkerStatement`, `MarkerReadShape`, `MarkerReadQueryable`, and `readMarkerResult` from `packages/2-sql/9-family/src/core/verify.ts`. Move the read flow (probe → select → optional decode → parse → tag) into `adapter-postgres/src/core/marker-read.ts` and `adapter-sqlite/src/core/marker-read.ts` (each returning `MarkerReadResult` directly). Wire each adapter's existing `readMarker` method to call its own per-package implementation. `family-sql/verify.ts` and the runtime adapters call `adapter.readMarker(driver, space)` and use the tagged result. The two `readMarker` methods on the control adapter (one for control, one for runtime) keep their existing return shapes (`ContractMarkerRecord | null` for control via `present→record / else→null` projection; `MarkerReadResult` for runtime). `parseContractMarkerRow` stays in `verify.ts` as the single shared parser.
- **Builds on:** D3's parser unification (the parser is right; the orchestration home is wrong).
- **Hands to:** symmetric SPI shape — the adapter owns each operation end-to-end on both read and write sides, matching Mongo.
- **Focus:** delete the leaky abstraction; move the orchestration into each adapter; keep the pure parser shared. Per-adapter orchestration code is ~15 lines; the "duplication" is the cost of giving each adapter end-to-end control (the right kind of duplication). Tests already exist for `MarkerReadResult` semantics on both dialects (D3 added integration tests); those must keep passing.
- **Composer constraints reminder:** the write-side SPI in this slice is the reference shape (`adapter.initMarker(driver, space, destination)`, `adapter.updateMarker(...)`, `adapter.writeLedgerEntry(...)` — adapter owns the whole operation, family-sql calls and forgets). Mirror that on the read side. Do not introduce a new helper, base class, or shared "read template" beyond `parseContractMarkerRow`. Do not preserve `MarkerReadShape` "in case someone needs it later".
- **Stop conditions specific to D6:** if implementer feels the urge to factor out "common bits" of the two adapters' `readMarker` implementations beyond `parseContractMarkerRow`, HALT — see **F18** in failure-modes.md, that urge *is* the failure mode this dispatch exists to remove. The right shape is ~15 lines of orchestration per adapter, end of story.

### Validation gate for D5 + D6 (in addition to the all-dispatches gate below)

- `pnpm fixtures:check` byte-identical (the changes are structural — the lowered SQL stays the same).
- `pnpm test:packages` filtered to `@prisma-next/relational-core` + `@prisma-next/family-sql` + `@prisma-next/adapter-postgres` + `@prisma-next/adapter-sqlite` + `@prisma-next/target-postgres` + `@prisma-next/target-sqlite` + `@prisma-next/sql-runtime`.
- `git grep` (must return ZERO matches in `packages/`, outside `projects/`):
  - After D5: `TableSource` followed by `schema` in `relational-core/`; `schema?:` on the generic core `TableSource`.
  - After D6: `MarkerStatement`, `MarkerReadShape`, `MarkerReadQueryable`, `readMarkerResult`.
- Reviewer check: each adapter's `readMarker(driver, space)` is genuinely end-to-end in its own package — surfaces, does not delegate to a shared orchestrator. Symmetry with the write SPI.
- Reviewer check (per dor.md overlay): every API change traced through all callers; no silent semantic change.

## Validation gate (all dispatches)

`pnpm typecheck` (full) · package-scoped `pnpm test` for `@prisma-next/family-sql` + `@prisma-next/adapter-postgres` + `@prisma-next/adapter-sqlite` (+ any touched target/runtime package) · `pnpm fixtures:check` (byte-identical) · biome on changed files. D4 additionally runs the workspace-wide test command + a `git grep` for the removed symbols.
