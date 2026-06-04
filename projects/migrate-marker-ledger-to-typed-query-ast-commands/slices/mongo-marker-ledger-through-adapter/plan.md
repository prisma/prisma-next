# Dispatch plan — mongo-marker-ledger-through-adapter

**Spec:** [`./spec.md`](./spec.md) · **Design rationale:** parent [`design-notes.md`](../../design-notes.md) § "Mongo slice (TML-2825)" · **Linear:** TML-2825

## At a glance

Two dispatches, sequential, mirroring the calibration's clean **substrate → consumer-migration** split. **D1** lands the design-heavy core — the contract-free construction surface (the F21-risk part the SQL slice failed on three times) — tested in isolation. **D2** is the mechanical, behaviour-invariant consumer migration: reroute the six `MongoControlAdapterImpl` methods through that surface + the adapter lowering, and delete the three local executors, two `as` casts, and `extractDb` marker coupling.

Grounding established at plan time (so neither dispatch discovers a surprise): **no new AST nodes and no lowerer changes are needed** — the agg `operator` visitor lowers generically (`{ [op]: args }`), so the invariant-merge `$setUnion`/`$sortArray`/`$ifNull` ride it; `$expr` rides the existing `MongoExprFilter`; `$type` rides `MongoFieldFilter`'s generic `op`. `createMongoAdapter().lower(plan, {})` and `MongoDriverImpl.fromDb(db).execute(wireCommand)` both already exist. `CodecCallContext` is `{ signal? }` → pass `{}`.

> **Model / framing guidance** (per `learnings.md` subagent-policy + retro F17/F21): **D1 is design-judgment work** — assign a strong implementer (`claude-4.6-sonnet-high-thinking` or Opus), **not** Composer. Its brief must assert the architectural **property** (a contract-free surface that *earns its keep* by reusing `createFieldAccessor` and producing canonical command nodes), not the mechanics ("build helpers"). D2 is mostly mechanical but touches deletions across callers — mid/strong tier; brief must require tracing each method change against its callers (F19) and forbid self-acknowledged layering-violation comments (F16).

## Dispatch 1: Contract-free Mongo control-construction surface

- **Outcome:** A contract-free surface exists that (a) declares the `_prisma_migrations` control-doc shape once, (b) reuses the existing contract-free `createFieldAccessor` (no re-derivation of `PipelineChain`; no contract), and (c) constructs the **canonical** structured command nodes (`AggregateCommand` / `InsertOneCommand` / `FindOneAndUpdateCommand`) for every query shape the six marker/ledger ops need — including `readAllMarkers`'s `$type` + `$expr` filter (via additive `.type()` / `expr()` sugar over `MongoFieldFilter`'s generic `op` and the existing `MongoExprFilter` + `fn.eq`) and the server-side invariant-merge update pipeline (`$setUnion`/`$sortArray`/`$ifNull` via the generic agg `operator`). Unit tests assert the surface produces the expected command/filter/pipeline shapes. **No adapter rerouting; no executor deletion.**
- **Builds on:** the spec's chosen design (and the verified facts above — adapter→`mongo-query-builder` import is allowed; no new AST nodes/lowerer needed).
- **Hands to:** a unit-tested contract-free construction surface — typed builders that emit canonical `Aggregate/InsertOne/FindOneAndUpdate` commands for the control collection, with `$type`/`$expr`/invariant-merge expressible. This is the stable surface D2 consumes.
- **Focus:** the surface module + the additive `.type()`/`expr()` helpers on the contract-free field surface; the `@prisma-next/adapter-mongo` → `@prisma-next/mongo-query-builder` dependency edge. **Out:** the adapter methods, the dispatch helper, any executor deletion (all D2). **Gates:** package typecheck + new unit tests for the surface; `pnpm lint:deps` (confirms the new cross-domain edge is clean); if `.type()` widens a shared interface used by an exhaustive consumer, a non-cached workspace `pnpm typecheck` (per `learnings.md` blast-radius lesson) — expected low-risk since it's additive.

## Dispatch 2: Route the six marker/ledger ops through the adapter; delete the legacy executors

- **Outcome:** All six `MongoControlAdapterImpl` methods (`readMarker` / `readAllMarkers` / `readLedger` / `initMarker` / `updateMarker` / `writeLedgerEntry`) construct their command via D1's surface and dispatch through one private helper — `executeControl(command)` = wrap in `MongoQueryPlan` → `createMongoAdapter().lower(plan, {})` → `MongoDriverImpl.fromDb(db).execute(wireCommand)`. The three local executors (`executeAggregate` / `executeInsertOne` / `executeFindOneAndUpdate`), the two `as` casts, and the `extractDb` marker coupling are **deleted, not wrapped**. Behaviour is invariant: the existing `marker-ledger.test.ts` (CAS, invariant-merge accumulate-dedupe, read tagging, ledger filtering) stays green.
- **Builds on:** Dispatch 1's construction surface (the tested typed command builders).
- **Hands to:** a fully adapter-routed Mongo marker/ledger path — slice-DoD met (the slice's PR-ready state).
- **Focus:** `mongo-control-adapter.ts` (the six methods + `executeControl`) and `marker-ledger.ts` (delete the executors/casts; `parseMongoMarkerDoc` stays). **Gates:** existing `marker-ledger.test.ts` green (behaviour-invariant proof); `rg` gates — zero `db.collection(...).{aggregate,insertOne,findOneAndUpdate}` and zero `extractDb(` in marker/ledger paths, zero `as` casts in `marker-ledger.ts`; cast ratchet not regressed; `pnpm typecheck` + affected-package tests; trace each of the six method changes against its callers (`control-instance.ts`, `mongo-runner.ts`, `runner-deps.ts`, `exports/control.ts`) — confirm no caller relied on `insertOne` upsert semantics (no F19 dual-caller hazard).

## Handoff completeness check

The slice-DoD is fully reachable: surface authored (D1) + consumed as first consumer (D2); zero `db.collection` + executors/casts/`extractDb` deleted (D2); `$type`/`$expr` via additive surface (D1); SPI shape unchanged (both); cast ratchet (D2). No DoD item is orphaned.

## Out of scope (per spec — candidate follow-up)

Mongo **migration-op** adoption of the contract-free surface (`CreateCollectionCommand` / `CreateIndexCommand` via `MongoCommandExecutor`). If, during D1, the surface's shape clearly wants to cover DDL too and one review can't hold both, fan out a third dispatch / sibling slice rather than widening D1.
