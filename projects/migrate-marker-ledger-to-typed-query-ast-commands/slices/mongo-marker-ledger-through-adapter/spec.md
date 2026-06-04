# Slice: mongo-marker-ledger-through-adapter

_(In-project slice: parent project `projects/migrate-marker-ledger-to-typed-query-ast-commands/`. Outcome: every Mongo marker/ledger operation reaches the database through `adapter.lower()` → driver, constructed via a contract-free surface that reuses the user-facing builder's primitives — closing the literal scope the original ticket (TML-2253) described for Mongo.)_

> Parallel group A. Shares no code with the SQL stack (slices `ddl-in-query-ast`, `sql-marker-ops-through-adapter`); keeps CI green on its own. This slice mirrors the **landed SQL pattern** (`PostgresControlAdapter` + its contract-free `table.ts` surface) for the Mongo family, adapted to Mongo's command-over-documents model.

## At a glance

Route the six Mongo marker/ledger operations (`readMarker` / `readAllMarkers` / `readLedger` / `initMarker` / `updateMarker` / `writeLedgerEntry`) through `adapter.lower()` → driver instead of the three local `db.collection()` executors in `marker-ledger.ts`, by building the **existing structured command AST** (`AggregateCommand` / `InsertOneCommand` / `FindOneAndUpdateCommand`) through a new **contract-free construction surface** that reuses the user-facing builder's already-contract-free `createFieldAccessor` + filter/agg primitives. The two `as` casts and the `extractDb` marker coupling are eliminated.

## Chosen design

### 1. Construct canonical structured command nodes — no new AST layer

The contract-free surface produces the **real** command nodes from `@prisma-next/mongo-query-ast` (`packages/2-mongo-family/4-query/query-ast/src/commands.ts`): `AggregateCommand`, `InsertOneCommand`, `FindOneAndUpdateCommand`. This mirrors the SQL slice's `relational-core/src/contract-free/table.ts`, whose `.build()` returns a real `InsertAst` / `UpdateAst` — **not** a parallel node-set that re-lowers into the canonical AST. The `Raw*` command family (`RawAggregateCommand` / `RawInsertOneCommand` / `RawFindOneAndUpdateCommand`) is **not** used for marker ops; those nodes lower as opaque pass-through (plain `Document`), which is exactly the construction surface this slice is meant to replace.

### 2. The contract-free surface reuses the builder's contract-free core

The typed construction helper **already exists and is reused in place** — no new helper, no relocation, no duplication. `createFieldAccessor` (`packages/2-mongo-family/5-query-builders/query-builder/src/field-accessor.ts`) is **already contract-free** — parameterized only by a plain `DocShape`, it emits `MongoFieldFilter` / `MongoAggFieldRef` / update-ops with zero contract coupling. (The contract coupling in the user-facing builder lives only in `query.ts` / `result-shape.ts` / `lookup-builder.ts`, which we do **not** touch.) The adapter takes a dependency on `@prisma-next/mongo-query-builder` to use it — **verified allowed**: `architecture.config.json` `crossDomainRules.targets.mayImportFrom` includes `mongo` with no layer restriction, and the adapter already imports higher mongo layers (`transport`). The surface declares the `_prisma_migrations` control-doc shape **once** so field access is typed and codecs/paths are not threaded at call sites.

> **Note (corrected from the design discussion):** the discussion briefly considered building a *new* self-contained field handle in `mongo-query-ast` to mirror SQL's `table.ts`. That mirror does **not** apply: SQL had to build its own only because *its* user-facing field machinery is contract-bound; Mongo's `createFieldAccessor` is already contract-free, so reuse is strictly better and avoids duplication.

**Worked before/after** (`updateMarker`, the CAS advance). The user-facing `.match().findOneAndUpdate()` chain lives on contract-bound state classes, so it is **not** used; instead the filter/update are built with the contract-free field accessor + agg-expr layer and passed to the canonical command constructor directly:

```ts
// before — hand-built documents + Raw* command + local executor (bypasses adapter)
const update: Document | Document[] = destination.invariants === undefined
  ? { $set: setBase }
  : [{ $set: { ...setBase, invariants: { $sortArray: { input: { $setUnion: [{ $ifNull: ['$invariants', []] }, destination.invariants] }, sortBy: 1 } } } } }];
const cmd = new RawFindOneAndUpdateCommand(COLLECTION, { _id: space, space, storageHash: expectedFrom }, update, false);
const result = await executeFindOneAndUpdate(db, cmd);          // db.collection(...).findOneAndUpdate(...)  + `as` cast inside

// after — typed filter + update via reused createFieldAccessor / agg layer; canonical command; lowered through the adapter
const f = createFieldAccessor<ControlDocShape>();               // declared _prisma_migrations control-doc shape
const filter = f.space.eq(space).and(f.storageHash.eq(expectedFrom));   // → MongoFilterExpr
const update = [f.stage.set({ storageHash: destination.storageHash, profileHash: destination.profileHash,
  updatedAt: now, invariants: invariantMergeExpr(f, destination.invariants) })];   // typed agg-expr, server-side $setUnion/$sortArray
const cmd = new FindOneAndUpdateCommand(COLLECTION, filter, update, /* upsert */ false);
const result = await this.executeControl(cmd);                  // createMongoAdapter().lower({command:cmd,…}, {}) → driver.execute(wire)
return result !== null;
```

### 3. Mirror the SQL family pattern: ops are adapter methods; one lower→dispatch helper

`MongoControlAdapterImpl` (`packages/3-mongo-target/2-mongo-adapter/src/core/mongo-control-adapter.ts`) keeps the six ops as class methods (already true post slice-2 D11). Each method builds a canonical command and runs it through **one** private helper — `executeControl(command)` — that does `wrap in MongoQueryPlan → createMongoAdapter().lower(plan, {}) → driver.execute(wireCommand)`. Both halves already exist: `createMongoAdapter()` exposes `lower(plan, ctx)`, and `MongoDriverImpl.fromDb(db).execute(wireCommand)` (`packages/3-mongo-target/3-mongo-driver`) already implements the wire-command transport (the mongo extension runtime uses it). This is the exact structural analogue of SQL's `execute((q) => this.lower(q, …), driver, query)` → `driver.query(sql, params)`. The three local executors (`executeAggregate` / `executeInsertOne` / `executeFindOneAndUpdate`), the two `as` casts, and the `extractDb` coupling **for marker ops** are deleted, not wrapped — `extractDb` drops out because ops dispatch via the wire `execute` transport rather than reaching for `.collection()`. The invariant-merge stays **server-side** as a typed agg-expression in the update pipeline (Mongo has no TS-side `mergeInvariants` helper — that was SQL); `parseMongoMarkerDoc` stays the sole shared pure parser.

### 4. Reads stay aggregate pipelines

`readMarker` / `readAllMarkers` / `readLedger` remain `$match` / `$limit` / `$sort` aggregates built as `AggregateCommand`. `findOne` is a deliberately-avoided legacy Mongo API. **The ticket's proposed new `RawFindOneCommand` is struck — no read-one node is added.**

### 5. `$type` / `$expr` reads expressed in our own AST via a tiny additive extension

`readAllMarkers`'s filter `{ _id: { $type: 'string' }, $expr: { $eq: ['$_id', '$space'] } }` is expressed in the typed AST, **not** via a raw escape hatch:

- `$type` needs **no new node** — `MongoFieldFilter` stores a generic `op: string`; the work is surfacing a `.type(bsonType)` ergonomic on the contract-free field surface.
- `$expr` **already exists** as `MongoExprFilter.of(aggExpr)`; `$eq` between two field refs is `fn.eq(a, b)` (`expression-helpers.ts`) over `MongoAggFieldRef`s the accessor already carries. The work is surfacing an `expr(...)` helper.

Zero new AST nodes; additive surface methods only.

## Coherence rationale

One reviewer holds it in one sitting: the slice migrates **all** Mongo marker/ledger call sites onto the contract-free surface + adapter-lowering path and removes the local executors in one move. Splitting reads from writes (or the surface from its first consumer) would leave a half-migrated marker path with the executors still present — the exact "unused/unvalidated surface" anti-pattern the parent project's transitional-shape constraints forbid.

## Scope

**In:** the contract-free Mongo construction surface (reusing the existing `createFieldAccessor` + filter/agg primitives in place; declares the control-doc shape; constructs canonical structured command nodes); the additive `.type()` / `expr(...)` surface methods; the `adapter`-dependency on `@prisma-next/mongo-query-builder`; rerouting all six `MongoControlAdapterImpl` marker/ledger methods through `construct → createMongoAdapter().lower() → MongoDriverImpl.fromDb(db).execute()`; deletion of `executeAggregate` / `executeInsertOne` / `executeFindOneAndUpdate`, the two `as` casts, and the `extractDb` marker coupling; marker/ledger reads + writes as the surface's first consumer.

**Out:** Mongo **migration-op** adoption of the contract-free surface (the "go further" second consumer — `CreateCollectionCommand` / `CreateIndexCommand` via `MongoCommandExecutor`); **may fan out** into its own slice/dispatch per the ticket. SQL family (other slices). User-facing `mongoQuery` builder refactors. Any change to marker/ledger storage shape, collection layout, or CAS semantics.

## Adapter-impact

- **mongo** (`packages/3-mongo-target/2-mongo-adapter`, `packages/2-mongo-family/**`): the only adapter touched. `MongoControlAdapter` SPI shape is **unchanged** and stays symmetric with `SqlControlAdapter` (read + init + advance + ledger-append); the change is in how each method constructs and dispatches. New workspace dependency: `@prisma-next/adapter-mongo` → `@prisma-next/mongo-query-builder` (cross-domain `targets → mongo`, allowed). postgres / sqlite untouched.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| **Native BSON values must round-trip through structured lowering.** Structured lowering (`structuralLower` + `resolveParams`) resolves filter/update/pipeline values via the adapter's own **wire-type** codec registry + a `CodecCallContext` — **not** a contract. | Verified: `resolveParams` uses `this.#codecs` (wire-type, registered at `createMongoAdapter()`); `CodecCallContext` is `{ signal?: AbortSignal }`, so the control adapter passes `{}`. The marker doc's native values (string / `Date` / `string[]`) must encode cleanly through this path. If any value doesn't round-trip → **I12 halt + re-discuss**. | `mongo-adapter.ts` `resolveParams`; `framework-components/src/shared/codec-types.ts`. |
| **No SQL-style dual-caller (F19) hazard.** SQL's `sign()`-vs-runner split forced an `insertMarker`/`initMarker` divergence. | Mongo `initMarker` is `insertOne` (fail-loud on duplicate `_id` by nature) — insert-once already; no upsert collapse is planned. Preserve `insertOne` semantics; confirm no caller relies on upsert-on-init. | `control-instance.ts`, `mongo-runner.ts`, `runner-deps.ts`. |
| **Typed agg-operators for the merge.** The invariant-merge needs `$setUnion` / `$sortArray` / `$ifNull` as agg-expressions. | If named helpers don't exist in the agg-expr layer, use the **generic** `MongoOperatorExpr` node (operator-string + args) — no new AST node, mirroring how `$type` rides `MongoFieldFilter`'s generic `op`. Dispatch-time grep confirms which named helpers exist. | `aggregation-expressions.ts` (`MongoOperatorExpr`, kind `'operator'`). |

## Slice-specific done conditions

- [ ] Zero `db.collection(...).{aggregate,insertOne,findOneAndUpdate}` in marker/ledger code paths — every read/write goes `construct → createMongoAdapter().lower() → MongoDriverImpl.fromDb(db).execute(wireCommand)` (`rg` clean).
- [ ] `executeAggregate` / `executeInsertOne` / `executeFindOneAndUpdate`, the two `as` casts in `marker-ledger.ts`, and the `extractDb` marker coupling are **deleted, not wrapped**; cast ratchet not regressed.
- [ ] The contract-free Mongo construction surface is authored and is the construction path for all in-scope marker/ledger reads + writes; it reuses `createFieldAccessor` (no re-derivation of `PipelineChain`'s state machine) and produces canonical structured command nodes (no second AST layer; no option-bag wrappers over `new Raw*Command(...)` — F21).
- [ ] `readAllMarkers`'s `$type` / `$expr` filter is expressed via the additive typed surface (`.type()` / `expr(...)`), with **zero new AST nodes** and no raw escape hatch.

## Open Questions

**None.** All design questions were settled in the design discussion + codebase verification (see the design-decisions log). For the record, the three that were open during drafting and how they resolved:

1. **Where the contract-free surface lives** → resolved: reuse the existing `createFieldAccessor` in `@prisma-next/mongo-query-builder` in place; the adapter depends on that package (cross-domain `targets → mongo`, verified allowed). No new helper, no relocation.
2. **Invariant-merge form** → resolved: server-side typed agg-expression in the update pipeline (Mongo has no TS-side merge helper; the SQL `mergeInvariants` analogue does not apply).
3. **Wire execution** → resolved: `createMongoAdapter().lower(plan, {})` → `MongoDriverImpl.fromDb(db).execute(wireCommand)`; both already exist. No new dispatcher / no new seam.

## References

- Parent project: `projects/migrate-marker-ledger-to-typed-query-ast-commands/spec.md`; plan `…/plan.md` (Parallel group A).
- Sibling SQL slice (landed reference pattern): `…/slices/sql-marker-ops-through-adapter/spec.md`; `PostgresControlAdapter` (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts` + `marker-ledger.ts`); contract-free surface (`packages/2-sql/4-lanes/relational-core/src/contract-free/table.ts`).
- Linear issue: [TML-2825](https://linear.app/prisma-company/issue/TML-2825). Related: TML-2253 (umbrella, closed eagerly), TML-2753 (SQL sibling), TML-2754 (planner DDL).
- Retro lessons that constrain this slice: `drive/calibration/failure-modes.md` **F16** (no self-acknowledged layering-violation comments — HALT instead), **F17/F21** (the surface must earn its keep by reusing the field accessor and producing canonical nodes — not option-bag wrappers over trivial constructors), **F18** (no inverted abstraction / shared template-method over adapter fragments), **F19** (trace API changes through all callers — confirmed no Mongo dual-caller hazard).
- ADR pointer: covered by the parent project's planned adapter-lowering ADR ("control-plane ops constructed as typed query-AST nodes lowered through the family adapter"); no separate Mongo ADR expected — this slice introduces no new architectural surface (it reuses the existing adapter lowering + wire transport + contract-free field accessor). Revisit only if planning surfaces an unforeseen shift.
- Design-decisions record: `projects/migrate-marker-ledger-to-typed-query-ast-commands/design-notes.md` (this slice's dated entry — the discussion outcome + the `createFieldAccessor`-reuse correction).
