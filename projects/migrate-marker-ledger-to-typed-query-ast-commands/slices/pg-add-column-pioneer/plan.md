# Slice 7 — `pg-add-column-pioneer` (plan)

**Spec:** `./spec.md` · **Base:** `main` once #807 (`control-query-extension-codecs`) merges — the folded-in codec dedup builds on #807's `CodecRegistry`. The AddColumn work itself is independent of #807; the base dependency is only the dedup commit.

## Template (proven, from slice 4 — mirror it)

`PostgresCreateTable` (frozen `PostgresDdlNode`, `ddl/nodes.ts`) ← `contractFreeDdl.createTable` ← lowered by `pgRenderDdlExecuteRequest` (`.kind` switch in `control-adapter.ts`) ← `CreateTableCall.toOp(lowerer)` (async, lowerer-required, wires lowered SQL + `to_regclass` checks into the Op) ← byte-parity oracle `ddl-create-table-lowering.test.ts`. AddColumn follows this five-layer shape; the column fragment reuses the adapter's existing `pgRenderDdlColumn` (so codec defaults flow through `pgRenderDdlColumnDefault`).

## Dispatches

### D1 — spike: settle the ALTER TABLE node shape (research artifact, NOT production code)
Decide and record, with code-cited justification, in `dispatches/01-alter-table-node-shape.md`:
1. **Node shape:** Option A (separate `PostgresAlterTableAddColumn` kind) vs Option B (polymorphic `PostgresAlterTable` + discriminated subaction list). Grounding read favours A (lowest-divergence mirror of the existing flat-per-action IR; B's batching has no consumer). The spike confirms or overturns, and records B as the migration target conditional on the planner coalescing subactions.
2. **Carrier:** confirm `AddColumnCall` carries a `DdlColumn` (codec-correct defaults via the adapter path) rather than the legacy pre-rendered `ColumnSpec.defaultSql`. Trace the planner site (`issue-planner.ts` `toColumnSpec`) — does it already have a `DdlColumn`, or build one? Note the touch.
3. **Walker:** decide whether to convert `pgRenderDdlExecuteRequest` from a `.kind` switch to an `accept`-based `PostgresDdlVisitor` dispatch now (2→3 kinds = cheapest moment; gains compiler-checked exhaustiveness). Recommend yes-or-no with the cost.
Completion = the decision artifact; re-triage into D2, not committed code.

### D2 — implement AddColumn through the typed path (per the D1 decision)
- Add the node class + (if D1 says so) the visitor conversion — `postgres/src/core/ddl/nodes.ts`.
- Contract-free constructor `addColumn({ schema, table, column: DdlColumn })` — `postgres/src/contract-free/ddl.ts`.
- Adapter walker arm `pgRenderAlterTableAddColumn` (reuse `pgRenderDdlColumn`) — `6-adapters/postgres/.../control-adapter.ts`.
- Rewrite `AddColumnCall.toOp` async + lowerer-required (mirror `CreateTableCall.toOp`); lift the `columnExistsCheck` precheck/postcheck framing into `toOp` (today it comes from the `addColumn()` op factory). Carry `DdlColumn` — `op-factory-call.ts` (+ the `issue-planner.ts` construction site + exports barrels).
- **Tests-first:** new byte-parity oracle `ddl-add-column-lowering.test.ts` (mirror create-table); update the all-`*Call` lowering smoke test for the now-async AddColumn; confirm `renderTypeScript` unchanged.
- Remove the `addColumn()` op factory (`operations/columns.ts`) if dead after the rewrite. **Leave** `buildAddColumnSql` + the temp-default recipe (out of scope per spec); a byte-parity assertion guards against divergence.
- Gates: build, typecheck, test:packages, **fixtures:check (must stay clean — byte-parity)**, lint:deps (standalone), lint:casts (delta 0), e2e migration suite for an additive AddColumn.

### D3 — fold in the #807 codec-resolution dedup (separate commit)
Small, independent of the AddColumn work. Collapse the duplicated "find descriptor → `materializeCodec`" wrapper between `extractCodecLookup.forCodecRef` (framework) and `createAstCodecResolver.forCodecRef` (runtime), and/or the two descriptor indexes (`descriptorsById` vs `CodecDescriptorRegistry`). Scope it in the dispatch (the framework/SQL plane split limits a full collapse — decide how far). Its own commit on this branch; do NOT entangle with the AddColumn commits.

## Sequencing
D1 (spike) → D2 (implement) on the same branch; D3 (dedup) any time after the branch is cut off post-#807 main. One PR. Review pass (architect/principal-engineer) after D2+D3, then open the PR.

## Risks (from grounding; carry into the dispatches)
- precheck/postcheck ownership moves into `toOp` (the one spot the CreateTable template isn't a pure copy).
- `primaryKey: true` on an ADD COLUMN `DdlColumn` — forbid/pass-through (open question 3).
- walker `.kind`-dispatch gives no exhaustiveness check unless converted to a visitor (D1).
- second emitter `buildAddColumnSql` stays live — byte-parity must cover the new path.
