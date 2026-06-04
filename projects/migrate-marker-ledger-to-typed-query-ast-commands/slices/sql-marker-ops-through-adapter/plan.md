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

## Corrective dispatches round 2 (added 2026-06-03 after D5/D6/D7 reviewed at PR #712)

D5/D6/D7 closed SATISFIED but operator review surfaced a deeper miss conditioning D1: the contract-free authoring surface (`relational-core/src/contract-free/dml.ts`) is not actually a query builder — it's option-bag wrappers around the chainable AST class API that already exists. Marker writes that use it thread codec IDs / table names / column refs at every leaf; marker reads use raw SQL strings. See [spec round 2 corrective scope](./spec.md#corrective-scope-round-2-added-2026-06-03-after-corrective-dispatches-d5d6d7-reviewed-at-pr-712), [retros round 2](../../retros.md#2026-06-03-round-2--slice-2-corrective-work-shipped-operator-caught-a-deeper-architectural-miss), and [F21 in failure-modes.md](../../../../drive/calibration/failure-modes.md#f21-implementer-ships-ast-construction-by-hand-wrapped-in-option-bag-factories-instead-of-building-the-fluent-authoring-surface-the-slice-exists-to-deliver).

Three more dispatches, **all to `claude-4.6-sonnet-high-thinking` (mid tier)**. Implementer slot upgraded from `composer-2.5-fast` because the work is design-heavy (architectural taste over mechanical correctness); cheap-tier implementers default to the lowest-cost-to-satisfy interpretation, which on ergonomics slices is the wrong-shape interpretation.

### D8 — Replace `dml.ts` with a real contract-free fluent authoring surface

- **Outcome (property statement — ergonomic):** the contract-free module at `packages/2-sql/4-lanes/relational-core/src/contract-free/` is a fluent authoring surface analogous in *spirit* to `sql-builder`'s contract-bound `sql()` interface, much simpler (no contract, no `ExecutionContext`, no codec-lookup-through-registry indirection). Specifically: typed table declarations carry column metadata at declaration time (`const marker = table('prisma_contract.marker', { space: text(), core_hash: text(), … })`); column proxies expose expression methods (`marker.space.eq(value)` returns an expression; `expr.and(other)`, `expr.or(other)` compose); operations expose a fluent chain (`marker.update().set({…}).where(...).returning(...)`, `marker.insert({…})`, `marker.upsert({…}).onConflict('space').doUpdate({…})` or similar — exact chain shape is the implementer's design call); the chain terminates in an AST node from the existing `relational-core/ast/types.ts` (no new AST classes). The current option-bag wrappers (`insert(table, row)`, `update({…})`, `upsert({…})`) are deleted; `tableRef` / `excludedColumn` / `dbExpr` / `param` survive only as primitives the new builder genuinely needs.
- **Builds on:** the existing AST class chain (already exposes `.withSet(…)` / `.withWhere(…)` / `.withOnConflict(…)` etc.) and `sql-builder`'s contract-bound surface (the *spirit* reference; do **not** copy its types literally, do **not** import from it — different runtime, no `ExecutionContext`).
- **Hands to:** D9, which rewrites the marker/ledger code against this surface.
- **Focus:** real fluent design. The Sonnet implementer makes the actual API design call (`.update().set(…)` vs `.update({…})`; `.where(predicate)` taking an expression vs taking a callback; how `RETURNING` chains; how `ON CONFLICT` chains) — guided by *spirit-of-`sql-builder`*, constrained by *no contract / much simpler*. The brief asserts the ergonomic property; the implementer ships the API.
- **Reference (spirit, not literal):** read `packages/2-sql/4-lanes/sql-builder/` end-to-end before designing — `src/runtime/sql.ts`, `src/types/db.ts`, `src/types/select-query.ts`, `src/types/mutation-query.ts`, `src/scope.ts`, the runtime `*-impl.ts` files. Note how column proxies expose expression methods, how chains compose, how mutations work. Then design the contract-free analog that delivers the same authoring ergonomics for tables declared literally rather than derived from a contract.
- **Per-target codec helpers** (`text()`, `int4()`, `jsonb()`, `textArray()`, `timestamptz()`, etc.) live under `@prisma-next/target-postgres/contract-free` and `@prisma-next/target-sqlite/contract-free` so column declarations bind codec IDs at declaration time (no per-call-site codec threading). The implementer designs the column-helper shape (return type, what it exposes, how the column proxy derives) as part of D8.
- **Vocabulary:** "contract-free" throughout. No "control" anywhere (control-plane is the current consumer, not the abstraction). Folder stays at `relational-core/src/contract-free/` (existing label, no rename).
- **Sonnet implementer constraints (mid-tier, design-heavy):**
  - **Read the reference end-to-end before designing.** Don't skim. The shape decisions are load-bearing; the brief gives spirit, the implementer gives the API. The reference is `sql-builder/` — read it; the design call is informed by it.
  - **Do not introduce new AST classes.** The chain terminates in the existing `InsertAst` / `UpdateAst` / `SelectAst` / etc. Existing renderers stay unchanged; existing `pnpm fixtures:check` stays byte-identical (the lowered SQL is the same; only the *authoring surface* changes).
  - **Do not import from `sql-builder`** (different runtime, contract-bound types). Mirror the *ergonomic property*, not the implementation.
  - **No proxies-via-`Proxy`-magic unless it falls out naturally.** Plain objects with typed column-field properties are preferable if they work; the contract-free case (table shape is statically known at declaration) doesn't need the dynamic-proxy machinery `sql-builder` uses for contract-resolved tables.
  - **Single Sonnet dispatch designs *and* implements D8.** Don't split into "design spike" + "implementation" — Sonnet's strength is holding both together.
  - **One commit.** Subject: `feat(sql): contract-free fluent authoring surface for control-plane DML (D8, TML-2753)`. Body explains the design decisions (chain shape, column-helper shape, where each piece lives).
- **Stop conditions:**
  - If you find the design genuinely cannot work without a new AST shape, HALT and surface — that's a design escape the orchestrator wants to decide.
  - If you find yourself writing a comment like "this is a stub until the chain is added" or "TODO: fluent surface" or "for now, callers do X by hand" — that's the F21 anti-pattern this dispatch exists to remove. HALT.
  - If a per-call-site usage example using the new surface still threads codec IDs, table names, or column refs at leaves, the surface hasn't been built. HALT, reconsider, do not ship.
- **Reviewer DoR (Sonnet reviewer, opus-4-7-thinking-high):**
  - Write a representative call site using the new surface (e.g. the marker `updateMarker` with CAS-WHERE + invariants merge); judge it readable as a human-author would. The "compiles + tests pass" check is necessary but not sufficient.
  - Confirm the chain composes (chain depth ≥ 2 in representative usage; no escape hatches that re-introduce the bag-of-options shape).
  - Confirm column proxies carry codec — no `param(value, { codecId: ... })` at write/read call sites.
  - Confirm output is existing AST classes; `pnpm fixtures:check` byte-identical.

### D9 — Rewrite marker/ledger writes + reads against the new surface; collapse `marker-read.ts` into `marker-ledger.ts`

- **Outcome (property statement):** marker/ledger writes and reads in `adapter-postgres/src/core/marker-ledger.ts` and `adapter-sqlite/src/core/marker-ledger.ts` are authored against D8's fluent surface. No per-call-site codec / table / column threading at leaves. Marker reads no longer use raw SQL strings via `driver.query(sql, [params])` — the probe + select are authored through D8. Each adapter's marker code is one file (`marker-ledger.ts`), not split across `marker-read.ts` + `marker-ledger-writes.ts`.
- **Builds on:** D8's authoring surface.
- **Hands to:** the slice's stated purpose (typed query AST commands for marker/ledger, in spirit).
- **Focus:** rewrite the consumers; collapse the split. No behaviour change — lowered SQL stays byte-identical (`pnpm fixtures:check` PASS); all existing marker-ledger tests still pin the same observable outcomes.
- **Probe vs SELECT** — the existence probe (`select 1 from information_schema.tables where table_schema = $1 and table_name = $2` on PG; `sqlite_master` query on SQLite) is target-specific introspection, not marker DML. If D8's surface naturally extends to such queries, author them through it; if not (e.g. these tables aren't user-declared schemas), the implementer surfaces the boundary in the dispatch report so D8 can be extended or the probe can stay raw with the justification recorded.
- **Sonnet implementer constraints (mid-tier):**
  - **Do not modify D8's surface.** If you find yourself wanting to bend D8, HALT and surface — that's a D8 issue, not a D9 fix.
  - **Each adapter's `marker-ledger.ts` is the only marker code file in `<adapter>/src/core/`.** Delete `marker-read.ts`; delete `marker-ledger-writes.ts`; the new `marker-ledger.ts` is the single home.
  - **No new abstractions in the adapters.** D8 supplied the authoring surface; D9 uses it. No "marker helper" shared between PG and SQLite — only the pure `parseContractMarkerRow` (already shared, retained).
  - **One commit per adapter** (one for postgres, one for sqlite) OR **one combined commit** — implementer's call, judged by which produces a coherent review.

### D10 — Rename `control-codec-registry` to plane-neutral

- **Outcome (property statement):** no surface in `packages/` is labelled with "control" unless it is genuinely control-plane-specific. The current `control-codec-registry` works in either plane (it doesn't depend on a contract); rename to a plane-neutral label. Suggested: `contractFreeCodecRegistry` / `createContractFreeCodecRegistry` (parallels the contract-free vocabulary used throughout the slice). Implementer may propose a different plane-neutral name if better.
- **Builds on:** D9's state of the world (rides on the same branch).
- **Focus:** rename + updating all imports + the export label. No behaviour change.
- **Sonnet implementer constraints:** rename, period. No refactoring of the registry's internals.

### Validation gate for D8 + D9 + D10 (in addition to the all-dispatches gate above)

- `pnpm fixtures:check` byte-identical (structural changes to authoring surface; lowered SQL stays the same).
- `pnpm typecheck` clean.
- `pnpm test:packages` filtered to `@prisma-next/relational-core` + `@prisma-next/family-sql` + `@prisma-next/adapter-postgres` + `@prisma-next/adapter-sqlite` + `@prisma-next/target-postgres` + `@prisma-next/target-sqlite` + `@prisma-next/sql-runtime`.
- **Per-call-site grep (D9):** `git grep -nE 'BinaryExpr\.(eq|and|or)|ColumnRef\.of\(|AndExpr\.of\(|param\(.*codecId:' packages/3-targets/6-adapters/postgres/src/core/marker-* packages/3-targets/6-adapters/sqlite/src/core/marker-*` returns zero.
- **Raw-SQL grep (D9):** `git grep -nF 'driver.query(' packages/3-targets/6-adapters/postgres/src/core/marker-* packages/3-targets/6-adapters/sqlite/src/core/marker-*` returns zero outside the fluent surface's `.execute()` (or equivalent terminal) calls.
- **File collapse (D9):** `marker-read.ts` and `marker-ledger-writes.ts` no longer exist in `adapter-postgres/src/core/` or `adapter-sqlite/src/core/`; `marker-ledger.ts` is the sole marker module in each.
- **Name grep (D10):** `git grep -n 'control-codec-registry\|controlCodecRegistry\|createControlCodecRegistry' packages/` returns zero.
- Reviewer check: representative call site (e.g. `updateMarker` with CAS-WHERE) reads cleanly as a downstream human author would.

_Sequencing: D8 → D9 → D10 (D9 depends on D8's shape; D10 is small + independent but rides on D9's branch state to keep PR-on-PR cost down)._

## Corrective dispatches round 3 (added 2026-06-04 after D8/D9/D10 reviewed at PR #712)

D8/D9/D10 closed SATISFIED but operator review surfaced three further findings — two real smells the round-2 work left unaddressed plus stylistic cleanup operator-elevated to slice scope. See [spec round 3 corrective scope](./spec.md#corrective-scope-round-3-added-2026-06-04-after-d8d9d10-reviewed-at-pr-712). Three more dispatches, all `composer-2.5-fast` (mechanical refactors with well-specified outcomes; no design judgement required after the round-3 spec edits).

### D11 — Marker/ledger operations become methods on control adapter classes (Postgres + SQLite + Mongo)

- **Outcome (property statement):** marker/ledger operations are methods on each control adapter class, not module functions with thin class delegation. `packages/3-targets/6-adapters/{postgres,sqlite}/src/core/marker-ledger.ts` and `packages/3-mongo-target/2-mongo-adapter/src/core/marker-ledger.ts` either no longer exist or contain only target-private helpers (not the per-operation functions). Class methods use `this.lower(...)` (SQL) or `extractDb(...)` (Mongo) directly; no threaded `lower` parameter.
- **Builds on:** D9's authoring surface (the fluent contract-free builder); D9's collapse of `marker-read.ts` + `marker-ledger-writes.ts` into a single `marker-ledger.ts`.
- **Hands to:** symmetric SPI shape — the class **is** the SPI implementation, end-to-end, no module-function indirection.
- **Focus:** mechanical refactor. Move each function body into its class-method counterpart on `PostgresControlAdapter` / `SqliteControlAdapter` / `MongoControlAdapterImpl`. Replace the threaded `lower` parameter with `this.lower(...)`. Delete the standalone module function. Update the existing unit tests to invoke through class instances (the tests already construct the class — they were calling the module functions for testability-in-isolation, which is the smell being removed). The shared `execute()` helper and any other private utilities can stay as module-private helpers in the file, or move to a static class method — implementer's call.
- **Why not a "common abstract base class with shared helpers":** the operations are dialect-specific (postgres uses `INSERT … ON CONFLICT`, sqlite same shape but different codec wiring, mongo uses commands entirely). The only shared piece across SQL adapters is `parseContractMarkerRow` (already shared in `family-sql/verify.ts`). Resist any urge to introduce a `SqlControlAdapterBase` or "marker mixin".
- **Composer constraints:**
  - **One commit per family** (or one combined commit — implementer's call): postgres + sqlite + mongo.
  - **Do not change behaviour.** `pnpm fixtures:check` byte-identical; all existing marker-ledger tests pass without modification of the assertions (only the call form changes — `markerLedger.foo(this.lower, driver, ...)` becomes `this.foo(driver, ...)`).
  - **Do not introduce new shared abstractions.** If you find yourself wanting to factor common bits across PG + SQLite, HALT — that urge is the F18 anti-pattern recapitulated.
  - **Mongo:** same move, but `extractDb(driver)` becomes a class-private helper (or stays a module-private helper in the same file). The class methods take `driver` per call (driver-bound-adapter refactor is the follow-up [TML-2820](https://linear.app/prisma-company/issue/TML-2820/driver-bound-control-spi-common-markerreader-abstraction), **not** in this dispatch).
- **Stop conditions:**
  - If you find a public callsite outside the class that imports a `marker-ledger.ts` function directly (rather than calling the SPI method on an adapter instance), HALT and surface — that's a real consumer the smell was hiding, and it changes the dispatch scope.

### D12 — Delete bootstrap-DDL residue (`sql-marker.ts`, both `statement-builders.ts`, `SqlStatement`)

- **Outcome (property statement):** `packages/2-sql/5-runtime/src/sql-marker.ts` and both `packages/3-targets/3-targets/{postgres,sqlite}/src/core/migrations/statement-builders.ts` are deleted. Their public exports are removed (`5-runtime/src/exports/index.ts` drops the `ensure*Statement` + `SqlStatement` + `APP_SPACE_ID` re-exports; both `{postgres,sqlite}/src/exports/statement-builders.ts` are deleted entirely). `SqlStatement` type is deleted from the workspace; `runner.executeStatement` uses the existing lowered-query type. SQLite's `MARKER_TABLE_NAME` / `LEDGER_TABLE_NAME` / `CONTROL_TABLE_NAMES` constants move to a new `packages/3-targets/3-targets/sqlite/src/core/control-tables.ts`. Test setup helpers (currently using `ensureSchemaStatement` + `ensureTableStatement` for raw DB setup) are rewritten in `packages/2-sql/5-runtime/test/utils.ts` using the contract-free DDL builders (`createSchema` / `createTable` from `postgres/contract-free/ddl.ts` etc.) + `control-adapter.lower()`. Byte-match oracle assertions in `packages/3-targets/6-adapters/{postgres,sqlite}/test/migrations/ddl-lowering.test.ts` (the assertions pinning lowered AST to `ensure*Statement.sql`) are deleted.
- **Builds on:** Slice 1's contract-free DDL builders + control-adapter lowering seam.
- **Hands to:** clean production source dirs (no test-only code in production); single source of truth for control-table names (sqlite); zero `SqlStatement` redundancy.
- **Focus:** deletion + migration. The deletion is the headline; the migration is making the consumers work without the deleted code. **Important:** the 5 integration tests under `test/integration/test/` that import `ensureSchemaStatement` / `ensureTableStatement` need to import from `5-runtime/test/utils.ts` (or wherever the new helpers land) — they're the real consumers of the deletion.
- **Composer constraints:**
  - **Three commits, ordered:** (1) move sqlite constants to `control-tables.ts` + update `issue-planner.ts` import; (2) rewrite test setup helpers in `5-runtime/test/utils.ts` against contract-free DDL builders + lower; (3) delete the three files + their exports + `SqlStatement` type + byte-match assertions, update integration test imports.
  - **`SqlStatement` replacement:** find the type the lowerer returns (`renderLoweredSql` or `executeQuery` return shape — `{ sql, params }` is already a structural type used elsewhere). Use that directly. If the structural type is anonymous, declare a single shared type in a sensible existing location (do **not** create a new file for one type). HALT and surface if the existing location is unclear.
  - **`APP_SPACE_ID`:** import directly from `@prisma-next/framework-components/control` at use sites; do not create a new re-export.
  - **The byte-match oracle deletion:** identify the specific assertions to delete (the ones comparing lowered AST output to a string the test itself defines). Keep any assertion that pins a *property* of the lowered AST (e.g. "the schema is `prisma_contract`") — that's not tautology. If unsure on a specific assertion, surface in the dispatch report; default to delete.
  - **Do not introduce a "test-fixtures package".** The helpers live in each package's `test/utils.ts`. If multiple packages need the same helper, replicate (the duplication is small and local).
- **Stop conditions:**
  - If a production callsite imports `SqlStatement` (not just tests / fixtures), HALT and surface — that means the structural type **is** load-bearing in production and the deletion needs more care.
  - If the contract-free DDL builders can't express the bootstrap DDL exactly (column types, defaults, etc.), HALT and surface — that's a gap in the contract-free DDL surface that should be filled in a separate dispatch, not papered over with raw SQL.

### D13 — `as` cast cleanup in test files + README L26 + column-helper test simplification

- **Outcome (property statement):** no bare `as T` casts in the 4 test files modified by this slice (relational-core `table.test.ts`, postgres `columns.test.ts`, postgres `control-adapter.test.ts`) — `as const` and `as unknown as X` (where TypeScript narrowing forces it) are exempt and preserved. README L26 of `packages/2-sql/5-runtime/README.md` is updated from "SQL Marker Management: ... (writes go through the control adapter SPI)" to reflect that reads + writes both go through the SPI now. Per-helper column-shape tests in `columns.test.ts` (postgres + sqlite) collapse into property-shape assertions.
- **Builds on:** Nothing structural — purely stylistic ride-along.
- **Hands to:** consistent test style; correct README prose; reduced test bulk.
- **Focus:** rule for `as` cleanup:
  - **Assignment cast (`const x = y as T`) → annotation (`const x: T = y`).**
  - **Property-access cast (`(x as T).prop`) → `const local = castAs<T>(x); local.prop` (or bind multiple props into a typed local).**
  - **`as unknown as X` (TypeScript narrowing forces it through `unknown`)** → preserved as-is. Do **not** translate to `blindCast<T, "Reason">` — the reason-string maintenance outweighs the safety in tests. Operator has elevated this preference.
  - **`as const`** → preserved (rule-exempt; correct usage).
- **Companion fixes (same commit):**
  - README L26: update prose to reflect SPI carries reads now.
  - `columns.test.ts` × 2: collapse `it('text() returns ...')` / `it('int4() returns ...')` per-helper assertions into a single `it('column helpers return expected shape')` with `toEqual` over a literals object.
- **Composer constraints:**
  - **One commit.** Subject: `chore(test): clean up bare as casts in slice 2 test files + README L26 + column-helper test simplification (TML-2753)`.
  - **Do not touch production code.** This dispatch is test files + one README only.
  - **Do not touch `marker-ledger-writes.test.ts`** — D11 will rewrite that test as part of the methods-on-class move. (Avoids merge conflict; D11's rewrite supersedes any cast cleanup here.)
  - **Note on `as unknown as` at table.test.ts:767 and columns.test.ts:2139:** both are TypeScript-narrowing-forced (discriminated union `onConflict.action`). Leave them as `as unknown as`; don't try to narrow with `if (action.kind === ...)` unless the narrowing falls out trivially.
- **Stop conditions:**
  - If a production file (non-test, non-README) has a bare `as` cast in the slice diff, surface it — that's an actual `no-bare-casts` rule violation worth a separate dispatch (not bundled here).

### Validation gate for D11 + D12 + D13 (in addition to the all-dispatches gate above)

- `pnpm typecheck` clean.
- `pnpm fixtures:check` byte-identical (refactor + deletion; no lowered-SQL change).
- `pnpm test:packages` filtered to `@prisma-next/relational-core` + `@prisma-next/family-sql` + `@prisma-next/adapter-postgres` + `@prisma-next/adapter-sqlite` + `@prisma-next/mongo-adapter` + `@prisma-next/target-postgres` + `@prisma-next/target-sqlite` + `@prisma-next/sql-runtime`.
- `pnpm test:integration` (covers the integration-test consumers of the deleted `ensure*Statement` helpers).
- **D11 grep:** `rg 'markerLedger\.(readMarker|insertMarker|initMarker|updateMarker|writeLedgerEntry)' packages/` returns zero.
- **D12 grep (file existence):** `ls packages/2-sql/5-runtime/src/sql-marker.ts packages/3-targets/3-targets/{postgres,sqlite}/src/core/migrations/statement-builders.ts 2>&1 | grep -c 'No such'` returns 3.
- **D12 grep (SqlStatement):** `rg 'SqlStatement' packages/ test/` returns zero.
- **D13 grep (bare casts):** `rg -nE '\bas\s+[A-Z][A-Za-z]*\b' packages/2-sql/4-lanes/relational-core/test/contract-free/table.test.ts packages/3-targets/3-targets/postgres/test/contract-free/columns.test.ts packages/3-targets/3-targets/sqlite/test/contract-free/columns.test.ts packages/3-targets/6-adapters/postgres/test/control-adapter.test.ts | rg -v 'as const|as unknown as'` returns zero.

_Sequencing: D11 + D12 + D13 in parallel (different file sets); babysit consolidates after all three review SATISFIED; final PR re-review + merge._
