# Slice 6 — `mongo-planner-create-collection-and-index-adoption` (plan)

**Spec:** `./spec.md` · **Base:** `main` (slices 5 + 7 merged; no sibling dependency). Design settled by the operator (2026-06-11) — see design-notes; **no spike dispatch**.

## Template (what this mirrors)

Two proven references, one per half:

- **Execution unification** mirrors the runner's own **data-transform arm** (`mongo-runner.ts:328`): `wire = await adapter.lower(plan, {})` → `for await (… of driver.execute(wire))`. The DDL arm (`mongo-runner.ts:155`, `step.command.accept(commandExecutor)`) converges onto it; `MongoCommandExecutor` (`packages/3-mongo-target/2-mongo-adapter/src/core/command-executor.ts`) is the deletion target. The SQL-family precedent for "one lowering entry accepts queries or DDL" is `Lowerer.lower(ast: AnyQueryAst | DdlNode, ctx)` (`packages/2-sql/9-family/src/core/control-adapter.ts:32`).
- **Construction migration** mirrors slice 3's corrective round (F21): the fluent `collection<Shape>(name)` surface (`packages/2-mongo-family/5-query-builders/query-builder/src/contract-free/collection.ts`) produces canonical frozen nodes; call sites never write `new …Command(...)` / `MongoFieldFilter.eq(...)` by hand.

Unlike PG, **no `toOp(lowerer)` threading and no async-lifting**: Mongo serializes the typed node into `ops.json` (`mongo-ops-serializer.ts`), so lowering happens execute-time in the runner, and `toOp()` stays sync. This is the settled design, not an implementation choice.

## Dispatches

### D1 — adapter DDL lowering + runner unification + executor deletion

Tests-first. One commit (or two: adapter, then runner+deletion).

- **Adapter:** extend `MongoAdapter.lower()` / `structuralLower` (`packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts:56`) and the `MongoQueryPlan` union with the five DDL kinds → documented wire commands: `{create: coll, …opts}`, `{createIndexes: coll, indexes: [{key, name, …opts}]}`, `{drop: coll}`, `{dropIndexes: coll, index: name}`, `{collMod: coll, …opts}`. Field-by-field projection mirrors what `MongoCommandExecutor` passed to the helpers (its `if (… !== undefined)` option-mapping moves into the lowering arms).
- **Lowering oracle (new test):** per kind × per option field, assert the exact wire command object. This is the Mongo analog of PG's `ddl-create-table-lowering.test.ts` byte-parity oracle.
- **Runner:** converge the DDL execute loop (`packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts:155`) onto `adapter.lower({command: step.command}, {}) → driver.execute(wire)`; consume the response iterator like the data-transform arm; verify server-error fidelity (spec open question 2).
- **Deletion:** `MongoCommandExecutor` class, its `runner-deps.ts` slot (`commandExecutor`), and export entries. `MongoInspectionExecutor` stays (and `command-executor.ts` may need a rename/split — keep the inspection half).
- **Behavioral tests:** rewrite `command-executor.test.ts` (mongodb-memory-server) to drive the new `lower → execute` path and keep asserting the resulting collections/indexes/validators — behavior parity for all five kinds, including drop/collMod (whose construction does not change).
- Gates: build, typecheck, test:packages, the Mongo integration suites, lint:deps, lint:casts (delta ≤ 0).

### D2 — contract-free builder DDL terminals + construction migration

Tests-first. Depends on D1 (parity assertions run through the unified path).

- **Builder:** add `.createCollection(options)` / `.createIndex(keys, options)` terminals to `CollectionBuilder` (contract-free entry of `@prisma-next/mongo-query-builder`), returning the canonical `CreateCollectionCommand` / `CreateIndexCommand`. Keys/options vocabularies reuse the existing types (`MongoIndexKey`, `CreateIndexOptions`, `CreateCollectionOptions`) — no parallel option shapes.
- **Migrate construction:** `CreateCollectionCall.toOp()` / `CreateIndexCall.toOp()` (`packages/3-mongo-target/1-mongo-target/src/core/op-factory-call.ts`) and the `createCollection()` / `createIndex()` factories (`migration-factories.ts:114,194`) construct via the builder; in-scope check filters move to the contract-free field accessor (`f.key.eq(…)`, `f.name.eq(…)`, the unique-flag AND-fold). Resolve spec open questions 1 (`validatedCollection` callers) and 3 (explicit index name on the wire) and record the answers in the dispatch artifact.
- **`rg`-clean conditions:** no `new CreateCollectionCommand(` / `new CreateIndexCommand(` / hand-written `MongoFieldFilter.eq(` / `MongoAndExpr.of(` in `migration-factories.ts` + `op-factory-call.ts` for the in-scope ops (serializer revival path exempt; drop/collMod factories exempt until Phase 2).
- `renderTypeScript()` output and op ids unchanged (authoring-surface stability) — assert in tests.
- Gates: as D1, plus fixtures:check.

### D3 — codec-resolution dedup (carried from slice 7; own commit, do not entangle)

Operator directive: this deferred cleanup lands on this branch. Collapse the duplicated "find descriptor → `materializeCodec`" wrapper between the framework `forCodecRef` (`extractCodecLookup`) and the runtime `createAstCodecResolver.forCodecRef`, and/or unify the two descriptor indexes (`descriptorsById` vs `CodecDescriptorRegistry`) — scope the exact collapse in the dispatch (the framework/SQL plane split limits a full merge; decide how far and record it). Tests pin the surviving resolver's behavior. Gates: build, typecheck, test:packages, lint:deps, lint:casts (delta ≤ 0).

## Sequencing

D1 → D2 on the same branch (D2's parity runs through D1's path); D3 any time, own commit. One PR. Review pass (architect/principal-engineer lens, opus) after D2+D3, rework, then PR + babysit to merge.

## Risks

- **Wire-command vs helper-call semantics.** Driver helpers may set defaults the raw wire command doesn't (e.g. index name computation, write concern). Mitigated by: explicit `name` already passed today; the behavioral suite re-asserting outcomes per kind; spec open questions 2–3 resolved in D1/D2.
- **`MongoQueryPlan`/wire-command type unions ripple.** Extending the plan union may touch `resolveParams`/codec paths that assume DML shapes — keep DDL lowering structural (no codec routing today) and assert `lint:deps` cleanliness.
- **`validatedCollection()`** keeps the factories alive — that's fine (they construct via the builder internally); the trap is deleting them prematurely and breaking marker bootstrap. Follow-up flagged, not absorbed.
- **Inspection/executor file split.** Deleting half of `command-executor.ts` must not orphan `MongoInspectionExecutor` exports consumed by `operation-preview.ts` and runner-deps.
