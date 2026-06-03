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
| SQLite invariant overwrite→merge | Layer relocation; net behaviour preserved (revised at D2) | **Revised:** the legacy SQLite *runner* (`runner.ts:605-607`) already pre-merges invariants client-side before its overwrite statement, so today's *net* SQLite behaviour already accumulate-dedupes — only the SQL *statement* overwrote. D2 relocates the merge into the `updateMarker` SPI (uniform TS merge, both dialects); D4's cut-over drops the runner pre-merge. Net observable behaviour is therefore **preserved**, not changed — the convergence is at the SPI/statement layer. Operator confirmation already given covered the stronger (behaviour-change) reading. **PR body must state this accurately** (relocation, not net change). |
| `meta`/`contract_json` JSON encoding skew | Fixed by value codecs | Today `sql-marker.ts` hand-`JSON.stringify`s `meta` but not `contract_json`; routing through codecs makes encode/decode uniform across dialects. |
| Marker read on absent table | Preserve tagged result | `MarkerReadResult` `no-table`/`absent`/`present` semantics unchanged. |

## Slice-specific done conditions

- [ ] Zero `driver.query(rawMarkerSql)` outside adapter lowering for in-scope SQL marker/ledger ops (`git grep` clean).
- [ ] The three raw-SQL write builders and the duplicate read/parse paths are removed, not wrapped.
- [ ] A test pins accumulate-dedupe invariant-merge for **both** Postgres and SQLite.
- [ ] `SqlControlAdapter` marker-write surface matches `MongoControlAdapter`'s shape.
- [ ] **(Added 2026-06-03)** Generic `TableSource` carries no target-specific fields; Postgres schema-qualification is expressed via `PostgresTableSource extends TableSource` in the postgres target package (mirroring Slice 1's `PostgresCreateTable` pattern). See [`.agents/rules/no-target-branches.mdc` § AST class fields are the same violation](../../../../.agents/rules/no-target-branches.mdc).
- [ ] **(Added 2026-06-03)** Each adapter owns `readMarker(driver, space)` end-to-end inside its own package. `family-sql/verify.ts` calls `adapter.readMarker(...)` and is unaware of probes, statements, or row decoders. `MarkerStatement`, `MarkerReadShape`, `MarkerReadQueryable`, and `readMarkerResult` no longer exist. Only `parseContractMarkerRow` (a pure parser) is shared. See [F18 in `drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md#f18-inverted-abstraction-shared-orchestrator-in-family-layer-takes-adapter-implementation-detail-fragments-via-an-interface).
- [ ] **(Added 2026-06-03)** `sign()` and the migration runner each use the marker primitive that matches *their* contract: `sign()` calls `insertMarker` (insert-only, fail-loudly on duplicate); the migration runner's idempotent re-apply calls `initMarker` (upsert). Already implemented at `5da812ac0` after CodeRabbit caught the race; retro lesson [F19](../../../../drive/calibration/failure-modes.md#f19-single-primitive-collapse-changes-semantics-for-some-callers-but-not-others).

## Corrective scope (added 2026-06-03 after PR #712 review)

Three architectural mistakes shipped under the original plan and were caught at operator review. Corrective dispatches land on the same branch (PR stays open); see updated `plan.md` for D5 + D6. Lessons landed in:

- [`projects/migrate-marker-ledger-to-typed-query-ast-commands/retros.md`](../../retros.md) — the retro entry.
- [`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md) — new entries **F16** (self-acknowledged layering violation), **F17** (brief frames win as mechanics), **F18** (inverted abstraction over adapter fragments), **F19** (single-primitive collapse changes semantics for some callers).
- [`drive/calibration/dor.md`](../../../../drive/calibration/dor.md) — Dispatch-DoR overlay items on property-statement framing, per-caller contract enumeration, and generic "trace each API change through callers" reviewer prompts.
- [`drive/code/README.md`](../../../../drive/code/README.md) — three new repo-specific smells for reviewers to flag.
- [`.agents/rules/no-target-branches.mdc`](../../../../.agents/rules/no-target-branches.mdc) — new section "AST class fields are the same violation" (worked PostgresTableSource example).

The three corrections, in order:

1. **Revert `TableSource.schema?` (generic core); introduce `PostgresTableSource extends TableSource` (postgres target).** The generic SQL core stays target-agnostic. Postgres-specific schema qualification reaches the renderer via a target-contributed subclass, mirroring Slice 1's `PostgresCreateTable` (which is the canonical pattern). The contract-free DML builder in `relational-core` is reshaped so generic `tableRef` / `insert` / `update` / `upsert` do not accept `schema`; postgres-specific schema-qualified DML construction lives in the postgres target package's contract-free surface (e.g. `@prisma-next/target-postgres/contract-free`). Marker/ledger write helpers in `adapter-postgres` adopt the new subclass.
2. **Read path: each adapter owns `readMarker(driver, space)` end-to-end.** Delete `MarkerStatement` / `MarkerReadShape` / `MarkerReadQueryable` / `readMarkerResult` from `packages/2-sql/9-family/src/core/verify.ts`. Both adapter packages (`adapter-postgres`, `adapter-sqlite`) gain a self-contained marker read flow (probe → select → decode → parse → tag) in their own package, returning a `MarkerReadResult` to the family. `family-sql/verify.ts` calls `adapter.readMarker(driver, APP_SPACE_ID)` and consumes the tagged result; the runtime adapter's existing `readMarker` (already adapter-owned) stays as-is. The **only** shared piece is `parseContractMarkerRow` (a pure parser over a typed row shape) — that's a genuine cross-dialect commonality. The 10–20 lines of "duplicated" orchestration between PG and SQLite are the right kind of duplication: the cost of giving each adapter end-to-end control over its operation.
3. **`sign()` race already fixed at `5da812ac0`.** No further code change. Done condition above pins the resolved shape; retro lesson F19 is the durable output.

## Corrective scope round 2 (added 2026-06-03 after corrective dispatches D5/D6/D7 reviewed at PR #712)

After D5/D6/D7 landed, operator review surfaced a deeper architectural miss conditioning the original D1 work: **the contract-free authoring surface (`packages/2-sql/4-lanes/relational-core/src/contract-free/dml.ts`) is not actually a query builder**. The current `insert(table, row)` / `update({...})` / `upsert({...})` helpers are option-bag factory wrappers around the chainable AST class API that already exists; they hide a chain without adding ergonomics. Marker writes that *use* these wrappers carry codec IDs / table names / column names at every leaf (`BinaryExpr.eq(ColumnRef.of('marker', 'space'), param(space, { codecId: PG_TEXT_CODEC_ID }))` repeated for every condition); marker read code (`marker-read.ts`, D6's deliverable) uses raw SQL strings via `driver.query(sql, [params])` and doesn't attempt the AST at all. The slice's named purpose (*"migrate marker/ledger to typed query AST commands"*) was satisfied literally but not in spirit.

Five operator findings on the review pass; see [retros.md round 2](../../retros.md) for diagnosis and root cause. Root cause: **D1's brief (orchestrator's) framed the win as "use the typed AST" instead of "deliver a fluent authoring surface analogous in spirit to `sql-builder` — typed table/column proxies that carry codecs, fluent chain, leaves don't restate context."** Composer's literal interpretation pattern-cloned Slice 1's atom-constructor shape (`col`/`lit`/`fn`, correct for DDL) into DML (which needs chainable composition). New durable lesson: [F21 in failure-modes.md](../../../../drive/calibration/failure-modes.md#f21-implementer-ships-ast-construction-by-hand-wrapped-in-option-bag-factories-instead-of-building-the-fluent-authoring-surface-the-slice-exists-to-deliver). Implementer slot for D8 onwards upgraded to `claude-4.6-sonnet-high-thinking` (mid tier; architectural taste required).

The five corrections:

1. **Replace `dml.ts` wholesale with a real contract-free fluent authoring surface.** Spirit of `sql-builder`'s contract-bound `sql()` interface, much simpler (no `ExecutionContext` / no contract / no codec-lookup-through-registry indirection): typed table declarations (`table('prisma_contract.marker', { space: text(), core_hash: text(), … })`), typed column proxies that carry codec (`marker.space.eq(value)`), fluent chain (`.update().set({...}).where(...).returning(...)`), produces existing AST classes (no new AST shape). The current option-bag wrappers (`insert`, `update`, `upsert`) and standalone helpers (`excludedColumn`, `dbExpr`, possibly `tableRef`) are deleted; `param` survives if the new builder genuinely needs it as a primitive.
2. **Per-target codec helpers live in the target packages' contract-free surfaces.** `text()` / `int4()` / `jsonb()` / `textArray()` / `timestamptz()` (etc.) under `@prisma-next/target-postgres/contract-free` and `@prisma-next/target-sqlite/contract-free`. Column declarations import from there so codec IDs are bound at declaration time, not threaded at call sites.
3. **Marker/ledger writes + reads are rewritten against the new builder.** No raw `driver.query(sql, [params])` for marker ops. The read flow (probe → select → parse → tag) authors the queries through the same fluent surface as the writes.
4. **Each adapter's marker code lives in one file (`marker-ledger.ts`), not split across `marker-read.ts` + `marker-ledger-writes.ts`.** Reads and writes against the same table belong in one module; the split adds an import boundary that wasn't earning its keep.
5. **`control-codec-registry` is renamed to a plane-neutral name** (suggested `contractFreeCodecRegistry` / `createContractFreeCodecRegistry`). The current name labels the first consumer rather than the abstraction's scope.

Plus orchestrator-side fixes (process surface): F19 DoR overlay item rewritten from file-enumeration to property-assertion (per operator's `dor.md:45` critique that file enumeration violates Drive's "briefs assert properties, not file lists" principle); F21 added to `failure-modes.md`.

### New done conditions (round 2)

- [ ] **(Added 2026-06-03 round 2)** Contract-free authoring surface (`packages/2-sql/4-lanes/relational-core/src/contract-free/`) is a real fluent builder: typed table declarations, typed column proxies that carry codec, fluent chain (depth ≥ 2 in representative usage), produces existing AST classes. No option-bag factory wrappers over the AST class chain. See [F21 in failure-modes.md](../../../../drive/calibration/failure-modes.md#f21-implementer-ships-ast-construction-by-hand-wrapped-in-option-bag-factories-instead-of-building-the-fluent-authoring-surface-the-slice-exists-to-deliver).
- [ ] **(Added 2026-06-03 round 2)** Marker/ledger writes and reads use the contract-free authoring surface; no per-call-site threading of codec IDs / table names / column refs at leaves. `git grep` for `BinaryExpr.eq(`, `ColumnRef.of(`, `AndExpr.of(`, `param(.*codecId:` in `adapter-postgres/src/core/marker-*` and `adapter-sqlite/src/core/marker-*` returns zero.
- [ ] **(Added 2026-06-03 round 2)** Marker/ledger reads do not use raw SQL strings — no `driver.query(` calls in `adapter-*/src/core/marker-*` outside the new fluent surface.
- [ ] **(Added 2026-06-03 round 2)** Each adapter's marker code lives in one file (`marker-ledger.ts`); no separate `marker-read.ts`.
- [ ] **(Added 2026-06-03 round 2)** No surface in `packages/` is named with "control" unless it is actually control-plane-specific (`control-codec-registry` renamed).

## Open Questions

1. **Upsert capability gating.** Working position: `INSERT … ON CONFLICT` on both Postgres and SQLite (both support UPSERT); gate if a target lacks it.
2. **"Single SPI" altitude.** Working position: per-family `SqlControlAdapter`; hoist a shared cross-family shape only if it falls out cleanly.

## References

- Parent project: `projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`
- Design notes: `projects/migrate-marker-ledger-to-typed-query-ast-commands/design-notes.md`
- Sibling (dependency): slice `ddl-in-query-ast`.
- Linear issue: TML-2753
- ADRs: 021, 043, 190, 204, 212.
