# Slice 6 — `mongo-planner-create-collection-and-index-adoption` (spec)

**Project:** migrate-marker-ledger-to-typed-query-ast-commands · **Phase:** 1 (prove planner adoption across all three targets) · **Linear:** [TML-2888](https://linear.app/prisma-company/issue/TML-2888)

> The design is **settled** (operator, 2026-06-11) — see the dated entry in [`../../design-notes.md`](../../design-notes.md) ("Slice 6 — Mongo planner DDL through the adapter"). No spike dispatch; the open questions below are mechanical, resolved during implementation.

## Purpose

Bring the Mongo migration path onto the project's two principles it still violates:

1. **One way to reach the wire.** Migration DDL today executes via `step.command.accept(commandExecutor)` → `MongoCommandExecutor` → driver *helper* calls (`db.createCollection(...)`, `db.collection(...).createIndex(...)`) — bypassing the adapter's lowering seam that marker DML (slice 3) and the runner's own data-transform path already use. After this slice, DDL goes `adapter.lower({command}, {}) → driver.execute(wireCommand)` like everything else, and `MongoCommandExecutor` is deleted.
2. **Construction via the contract-free builder, not hand-authored AST.** `migration-factories.ts` writes `new CreateCollectionCommand(...)` / `new CreateIndexCommand(...)` and hand-assembles check filters (`MongoFieldFilter.eq(...)`, `MongoAndExpr.of([...])`) — the F21 anti-pattern slice 3's corrective round eliminated for marker ops, explicitly deferring the migration-op consumer to this slice. The in-scope ops construct through the slice-3 fluent surface (`collection(name)` + DDL terminals added here).

Two op kinds (`CreateCollection` + `CreateIndex`) so the second exercises a structurally different command shape and surfaces substrate gaps a single-op slice would miss.

## At a glance

```ts
// before — runner DDL dispatch (mongo-runner.ts:155): helper-call executor, bypasses adapter
for (const step of ddlOp.execute) {
  await step.command.accept(commandExecutor);   // → db.createCollection(...) / db.collection(...).createIndex(...)
}

// after — unified on the path the data-transform arm already uses (mongo-runner.ts:328)
for (const step of ddlOp.execute) {
  const wire = await adapter.lower({ command: step.command }, {});
  for await (const _ of driver.execute(wire)) { /* consume */ }
}
```

```ts
// before — migration-factories.ts hand-authors nodes + filters
execute: [{ command: new CreateIndexCommand(collection, keys, { ...options, name }) }],
precheck: [{ source: new ListIndexesCommand(collection), filter: MongoFieldFilter.eq('key', keysToKeySpec(keys)), … }]

// after — canonical nodes produced by the contract-free builder
const c = collection(name);
execute: [{ command: c.createIndex(keys, options) }],
precheck: [{ source: …, filter: f.key.eq(keysToKeySpec(keys)), … }]   // contract-free field accessor
```

## The settled design (not re-opened here)

- **Mirror the SQL adapter interface.** SQL's `Lowerer.lower(ast: AnyQueryAst | DdlNode, ctx)` accepts queries *or* DDL. Mongo's `adapter.lower(plan, ctx) → AnyMongoWireCommand` grows the **five** DDL command kinds — `createCollection`, `createIndex`, `dropCollection`, `dropIndex`, `collMod` — each lowering to its documented wire command (`{create}`, `{createIndexes}`, `{drop}`, `{dropIndexes}`, `{collMod}`). All five lower (not just the two in-scope ops) so the runner's DDL dispatch is **uniform** and `MongoCommandExecutor` retires in this slice.
- **Lowering happens at the runner boundary, execute-time** — *not* plan-time inside `toOp(lowerer)` as in PG. Reason (recorded in design-notes): PG serializes the lowered form (`sql`) into `ops.json`; Mongo serializes the **typed node itself** (`mongo-ops-serializer.ts` revives `CreateCollectionCommand` from JSON). Plan-time lowering would degrade the serialized artifact to opaque wire documents. `toOp()` stays sync; no lowerer threading, no async-lifting of `renderOps`.
- **Construction through the contract-free builder.** `collection<Shape>(name)` (`@prisma-next/mongo-query-builder/contract-free`) gains `.createCollection(options)` / `.createIndex(keys, options)` terminals producing the canonical frozen nodes; in-scope check filters use the contract-free field accessor.
- **`MongoInspectionExecutor` stays.** Precheck/postcheck routing through the adapter is the separately-deferred `typed-migration-verification-queries` slice.

## Non-goals

- **Mongo only.** PG (slice 7, merged) and SQLite (slice 5, merged) are done.
- **Construction migration is `CreateCollection` + `CreateIndex` only.** `DropCollectionCall` / `DropIndexCall` / `CollModCall` keep their `migration-factories.ts` factories until Phase 2 — but their **execution** unifies now (uniform runner path; their commands lower through the adapter too).
- **No precheck/postcheck redesign.** `ListIndexesCommand` / `ListCollectionsCommand` checks still run through `MongoInspectionExecutor.accept()`; only the in-scope ops' *filter construction* moves to the contract-free accessor.
- **No marker/ledger changes.** Slice 3 finished that.
- **No `ops.json` format change.** The serialized artifact remains the typed command node; the serializer is untouched (the execute-step shape does not change).

## Cross-cutting requirements

- **Wire/behavior parity.** For each of the five DDL kinds, the lowered wire command must produce the same database effect as the retired `MongoCommandExecutor` helper calls. Pinned two ways: (a) a **lowering oracle** asserting the exact wire command produced per node across all supported option fields (validator, collation, capped, size, max, timeseries, clusteredIndex for `CreateCollection`; unique, sparse, expireAfterSeconds, partialFilterExpression, name, wildcardProjection, collation, weights, text-index for `CreateIndex`; plus the drop/collMod kinds); (b) the existing behavioral tests (`command-executor.test.ts` against mongodb-memory-server) rewritten to run through the new `lower → execute` path and still assert the resulting collections/indexes/validators.
- **One construction path.** In-scope ops are built exactly once, via the builder; `rg` for `new CreateCollectionCommand(` / `new CreateIndexCommand(` in `migration-factories.ts` and `op-factory-call.ts` comes back empty (builder internals and the serializer's revival path are exempt).
- **Green main between slices** (CI green; no sibling-merge dependency).
- **D3 carry-over rides this branch** (operator directive): the codec-resolution dedup deferred from slice 7 lands as its **own commit** on this branch — collapse the duplicated "find descriptor → `materializeCodec`" wrapper between the framework `forCodecRef` and the runtime `createAstCodecResolver.forCodecRef` (and/or the two descriptor indexes). Independent of the Mongo work; do not entangle commits.

## Definition of Done

- [ ] Team-DoD floor (repo gates, docs/migration, Linear close-out).
- [x] `MongoAdapter.lower()` accepts all five DDL command kinds and produces the documented wire commands; the `MongoQueryPlan` union is extended accordingly. *(D1)*
- [x] The runner's DDL dispatch goes `adapter.lower({command}, {}) → driver.execute(wire)` for **every** DDL step; `MongoCommandExecutor` is deleted (file, runner-deps slot, exports); `MongoInspectionExecutor` remains. *(D1)*
- [x] The contract-free builder exposes `.createCollection(options)` / `.createIndex(keys, options)`; `CreateCollectionCall.toOp()` and `CreateIndexCall.toOp()` (and the factories they delegate to, if retained for `validatedCollection`) construct via the builder, including check filters via the field accessor. *(D2)*
- [x] Lowering oracle covering all five kinds × all option fields; behavioral tests rewritten through the new path; `op-factory-call.test.ts` updated. *(D1)*
- [ ] D3 codec-resolution dedup landed as its own commit on this branch.
- [ ] `pnpm fixtures:check` clean; `pnpm lint:deps` passes; `pnpm lint:casts` delta ≤ 0.

## Open questions (mechanical — resolved during implementation, recorded in the dispatch)

1. **`validatedCollection()` call sites.** It composes `createCollection()` + `createIndex()` (marker bootstrap path). If it remains a caller, the two factories stay alive for it (constructing via the builder internally is fine); flag a follow-up to migrate `validatedCollection` rather than expanding this slice.
2. **Wire-command response consumption.** `driver.execute(wire)` is an `AsyncIterable` — confirm DDL wire commands' `{ok: 1}` responses iterate cleanly (the data-transform arm is the template) and that server errors surface with equivalent fidelity to the helper calls (e.g. `MongoServerError` codes the runner relies on, if any).
3. **`createIndexes` name defaulting.** The helper path let the driver compute the default index name; the factory already passes an explicit `name` (`defaultMongoIndexName(keys)`). Confirm the wire command always carries the explicit name so behavior is unchanged.
