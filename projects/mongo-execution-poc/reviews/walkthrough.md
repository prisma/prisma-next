# Walkthrough — Mongo Execution PoC (Milestone 1)

## Key snippet — the two-level command architecture

### New — MongoCommand (plan-level, typed values with param refs)

```typescript
export class FindCommand extends MongoCommand {
  readonly filter: MongoExpr | undefined;
  // ...
  constructor(collection: string, filter?: MongoExpr, options?: FindOptions) {
    super(collection);
    this.filter = filter;
    // filter values can be MongoParamRef instances
    this.freeze();
  }
}
```

### New — MongoWireCommand (driver-level, plain values)

```typescript
export class FindWireCommand extends MongoWireCommand {
  readonly filter: Document | undefined;
  // ...
  // filter values are resolved — no param refs
}
```

### New — Adapter lowering step (resolves param refs)

```typescript
function resolveValue(value: MongoValue): unknown {
  if (value instanceof MongoParamRef) return value.value;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(resolveValue);
  return resolveDocument(value as MongoExpr);
}
```

## Sources

- Spec: [projects/mongo-execution-poc/spec.md](../spec.md)
- Design reference: [docs/planning/mongo-target/1-design-docs/mongo-execution-components.md](../../../docs/planning/mongo-target/1-design-docs/mongo-execution-components.md)
- Linear: [Mongo PoC](https://linear.app/prisma-company/project/mongo-poc-89d4dcdbcd9a)
- Commit range: `origin/main...HEAD` (milestone 1 implementation commits: `edfd62679..697518f49`)

Relevant commits:

```
697518f49 rename packages/3-mongo to packages/2-mongo to reflect peer status with SQL
e5a748c07 fix PlanMeta stubs: remove nonexistent operationName, add required lane
f295d6888 add integration tests for full Mongo execution pipeline
4e4429c7b implement MongoDriver, MongoRuntimeCore, and memory-server test setup
6a96271a0 implement MongoAdapter lowering step with tests
3355715ea define MongoCommand, MongoWireCommand, and MongoParamRef class hierarchies
edfd62679 scaffold packages/3-mongo/ domain with core, runtime, adapter, driver packages
```

## Intent

Prove that Prisma Next's architecture can execute queries against MongoDB end-to-end — not by bolting Mongo onto the SQL runtime, but by building an independent execution pipeline that shares only the family-agnostic framework types (`PlanMeta`, `AsyncIterableResult`, `DocumentContract`). This is the prerequisite for everything else in the Mongo story: contract types, query surfaces, ORM.

## Change map

- **Implementation**:
  - [packages/2-mongo/1-core/src/commands.ts](packages/2-mongo/1-core/src/commands.ts) — MongoCommand class hierarchy (5 command types)
  - [packages/2-mongo/1-core/src/wire-commands.ts](packages/2-mongo/1-core/src/wire-commands.ts) — MongoWireCommand class hierarchy (driver-level)
  - [packages/2-mongo/1-core/src/param-ref.ts](packages/2-mongo/1-core/src/param-ref.ts) — MongoParamRef and value types
  - [packages/2-mongo/1-core/src/plan.ts](packages/2-mongo/1-core/src/plan.ts) — MongoQueryPlan and MongoExecutionPlan interfaces
  - [packages/2-mongo/6-adapter/src/mongo-adapter.ts](packages/2-mongo/6-adapter/src/mongo-adapter.ts) — Adapter lowering: command → wire command
  - [packages/2-mongo/7-driver/src/mongo-driver.ts](packages/2-mongo/7-driver/src/mongo-driver.ts) — Driver: wire command → mongodb driver calls
  - [packages/2-mongo/5-runtime/src/mongo-runtime.ts](packages/2-mongo/5-runtime/src/mongo-runtime.ts) — Runtime core: orchestrates adapter + driver
  - [architecture.config.json](architecture.config.json) — Registers `mongo` domain, layer order, import rules
- **Tests (evidence)**:
  - [packages/2-mongo/6-adapter/test/mongo-adapter.test.ts](packages/2-mongo/6-adapter/test/mongo-adapter.test.ts) — Adapter unit tests (7 tests)
  - [packages/2-mongo/5-runtime/test/find.test.ts](packages/2-mongo/5-runtime/test/find.test.ts) — Find integration (4 tests)
  - [packages/2-mongo/5-runtime/test/insert.test.ts](packages/2-mongo/5-runtime/test/insert.test.ts) — InsertOne integration (1 test)
  - [packages/2-mongo/5-runtime/test/update.test.ts](packages/2-mongo/5-runtime/test/update.test.ts) — UpdateOne integration (1 test)
  - [packages/2-mongo/5-runtime/test/delete.test.ts](packages/2-mongo/5-runtime/test/delete.test.ts) — DeleteOne integration (1 test)
  - [packages/2-mongo/5-runtime/test/aggregate.test.ts](packages/2-mongo/5-runtime/test/aggregate.test.ts) — Aggregate integration (1 test)
  - [packages/2-mongo/5-runtime/test/setup.ts](packages/2-mongo/5-runtime/test/setup.ts) — mongodb-memory-server replica set setup
  - [packages/2-mongo/5-runtime/test/helpers.ts](packages/2-mongo/5-runtime/test/helpers.ts) — Shared test helpers (plan factory, runtime factory)

## The story

1. **Scaffold the `2-mongo` domain as a peer to `2-sql`.** Four packages (`1-core`, `5-runtime`, `6-adapter`, `7-driver`) with the same build/test/lint infrastructure as existing packages. Register the `mongo` domain in `architecture.config.json` with its own layer order and import rules that forbid importing from `2-sql` or `3-extensions`.

2. **Introduce a two-level command representation.** Instead of the design doc's initial assumption that "the command IS the wire format," split into `MongoCommand` (plan-level, typed, with `MongoParamRef` values that carry codec metadata) and `MongoWireCommand` (driver-level, plain `Document` values). This mirrors SQL's `SqlQueryPlan` → `ExecutionPlan` split and creates a natural hook point for codec encoding in the adapter.

3. **Build the adapter as the lowering step.** The adapter recursively resolves `MongoParamRef` instances to their raw values, producing wire commands the driver can dispatch directly to `mongodb`. This is where codec encoding will live when M2 adds codecs.

4. **Build the driver as a dispatcher to `mongodb` methods.** Each wire command type maps to one `mongodb` driver method (`find()`, `insertOne()`, `updateOne()`, `deleteOne()`, `aggregate()`). Mutation results are normalized into single-element async iterables with fixed shapes (`{ insertedId }`, `{ matchedCount, modifiedCount }`, `{ deletedCount }`).

5. **Build the runtime core as the orchestrator.** It wires adapter → driver, wraps results in `AsyncIterableResult<Row>` from the framework's `runtime-executor` package — proving that type is family-agnostic.

6. **Prove it works against a real `mongod`.** Integration tests use `mongodb-memory-server` (replica set, `wiredTiger` engine) to run a real MongoDB instance in-process. Each operation type has a dedicated test file that seeds data via the raw `mongodb` client and verifies results through the full pipeline.

## Behavior changes & evidence

- **Adds a Mongo execution pipeline that takes a `MongoQueryPlan` and returns typed results via `AsyncIterableResult<Row>`**: The pipeline flows `MongoQueryPlan` → `MongoAdapter.lower()` → `MongoWireCommand` → `MongoDriver.execute()` → `AsyncIterable<Row>` → `MongoRuntime` → `AsyncIterableResult<Row>`.
  - **Why**: Prisma Next's runtime was SQL-only. MongoDB support requires an independent execution path that shares only the family-agnostic framework types.
  - **Implementation**:
    - [packages/2-mongo/5-runtime/src/mongo-runtime.ts](packages/2-mongo/5-runtime/src/mongo-runtime.ts) — lines 17–36
    - [packages/2-mongo/6-adapter/src/mongo-adapter.ts](packages/2-mongo/6-adapter/src/mongo-adapter.ts) — lines 58–112
    - [packages/2-mongo/7-driver/src/mongo-driver.ts](packages/2-mongo/7-driver/src/mongo-driver.ts) — lines 62–91
  - **Tests**:
    - [packages/2-mongo/5-runtime/test/find.test.ts](packages/2-mongo/5-runtime/test/find.test.ts) — full pipeline for find (4 tests)
    - [packages/2-mongo/5-runtime/test/insert.test.ts](packages/2-mongo/5-runtime/test/insert.test.ts) — full pipeline for insertOne
    - [packages/2-mongo/5-runtime/test/update.test.ts](packages/2-mongo/5-runtime/test/update.test.ts) — full pipeline for updateOne
    - [packages/2-mongo/5-runtime/test/delete.test.ts](packages/2-mongo/5-runtime/test/delete.test.ts) — full pipeline for deleteOne
    - [packages/2-mongo/5-runtime/test/aggregate.test.ts](packages/2-mongo/5-runtime/test/aggregate.test.ts) — full pipeline for aggregate

- **Adds a `MongoParamRef` value type that carries values with optional codec/name metadata through the plan until the adapter resolves them**: This allows plan-constructing code to attach codec IDs and parameter names to values, which the adapter strips when lowering to wire commands.
  - **Why**: Parallel to SQL's `SqlParamRef` — the plan-level representation needs to carry more than just the raw value so the adapter can perform codec encoding (not yet implemented, but the hook point exists).
  - **Implementation**:
    - [packages/2-mongo/1-core/src/param-ref.ts](packages/2-mongo/1-core/src/param-ref.ts) — lines 1–24
    - [packages/2-mongo/6-adapter/src/mongo-adapter.ts](packages/2-mongo/6-adapter/src/mongo-adapter.ts) — `resolveValue()` lines 34–48
  - **Tests**:
    - [packages/2-mongo/6-adapter/test/mongo-adapter.test.ts](packages/2-mongo/6-adapter/test/mongo-adapter.test.ts) — lines 37–48 (basic resolution), 141–155 (nested resolution)

- **Adds `mongodb-memory-server` test infrastructure with replica set support**: A shared setup file starts a single-node replica set with WiredTiger engine, provides connection URI and client accessors, and tears down after tests.
  - **Why**: Integration tests need a real `mongod` instance. A replica set (not standalone) is required for future transaction support.
  - **Implementation**:
    - [packages/2-mongo/5-runtime/test/setup.ts](packages/2-mongo/5-runtime/test/setup.ts) — lines 1–38
  - **Tests**:
    - All integration test files in `5-runtime/test/` depend on this setup

- **Registers `mongo` as a new domain in the architecture config**: Replaces the former `document` domain with `mongo`, adds layer order `["core", "runtime", "adapters", "drivers"]`, and restricts imports to `framework` only.
  - **Why**: Enforces the architectural boundary that Mongo packages never import from SQL or extensions packages.
  - **Implementation**:
    - [architecture.config.json](architecture.config.json) — domain rules and layer order additions
  - **Tests**:
    - Enforced by `pnpm lint:deps` (not run as part of the test suite on this branch — should be verified)

## Compatibility / migration / risk

- **`document` domain renamed to `mongo`.** No existing packages used the `document` domain, so no migration needed. However, if any downstream code referenced the domain name `document`, it would break. Low risk given this is a PoC with no consumers.
- **New `mongodb` and `mongodb-memory-server` dependencies.** Added to `2-mongo` packages only. `mongodb-memory-server` is `devDependencies` only. The `pnpm-workspace.yaml` adds `mongodb-memory-server` to `allowBuilds` and `semver` to `trustPolicyExclude`.
- **No impact on existing SQL packages or runtime.** All changes are additive in new packages.

## Follow-ups / open questions

- **Verify `pnpm lint:deps` passes.** The layer order has `runtime` before `adapters` and `drivers`, but `5-runtime` depends on both. Need to confirm the linter doesn't treat layer order as a strict dependency direction constraint.
- **Exhaustiveness checks for command dispatch.** Both adapter and driver dispatch via `instanceof` chains with a runtime fallback — a discriminated union with a `kind` field would provide compile-time safety (see code review F01).
- **Driver `as Row` casts.** Mutation result types are fixed shapes cast to a generic `Row` — consider typed result types for mutations (see code review F02).
- **`ObjectId` representation decision** — deferred to M2 when codecs are defined.

## Non-goals / intentionally out of scope

- **No contract types** — hand-crafted `contract.json`/`contract.d.ts` are M2.
- **No typed query surface** — row type inference from contracts is M3.
- **No plugin hooks** — lifecycle orchestration is understood; hooks are deferred.
- **No error handling / error envelopes** — connection and execution errors propagate raw.
- **No ORM client** — separate, later project.
