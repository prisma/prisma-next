# System Design Review — Mongo Execution PoC (Milestone 1)

**Branch:** `mongo-planning`
**Base:** `origin/main`
**Scope:** Milestone 1 — execution pipeline (scaffold through integration tests)
**Spec:** [projects/mongo-execution-poc/spec.md](../spec.md)
**Design reference:** [docs/planning/mongo-target/1-design-docs/mongo-execution-components.md](../../../docs/planning/mongo-target/1-design-docs/mongo-execution-components.md)

---

## What problem is being solved

Prisma Next's runtime was hardcoded to SQL — `ExecutionPlan` carries `{ sql: string, params: unknown[] }`, and every runtime component assumes SQL-shaped data. Before any MongoDB surface can exist (query builder, ORM, emitter), the execution path itself needs to work: a plan type, a driver, a lowering step, and a runtime core that orchestrates them.

Milestone 1 proves this path works end-to-end: hand-crafted `MongoQueryPlan` objects flow through `MongoAdapter` → `MongoDriver` → `mongodb-memory-server` and return correct results.

## New guarantees / invariants

1. **Mongo execution is independent of SQL.** All `2-mongo/*` packages import only from `1-framework/*` — never from `2-sql/*` or `3-extensions/*`. Enforced by `architecture.config.json` domain rules.

2. **Two-level command representation.** `MongoCommand` (typed, with `MongoParamRef` values) is a plan-level abstraction. `MongoWireCommand` (plain `Document` values) is what the driver consumes. The adapter performs the lowering between them — parallel to the SQL `SqlQueryPlan` → `ExecutionPlan` lowering.

3. **AsyncIterableResult is shared.** The same `AsyncIterableResult<Row>` wrapper from `@prisma-next/runtime-executor` is used for Mongo results, validating the claim that this type is family-agnostic.

4. **PlanMeta is reused as-is.** SQL-specific fields (`paramDescriptors`, `refs`, `projection`) are left empty/unused. The spec anticipated this and decided to split later if the mismatch is more than cosmetic.

---

## Subsystem fit

### Package layout

Four packages under `packages/2-mongo/`:

| Package | Layer | Role | SQL parallel |
|---|---|---|---|
| `1-core` | core | Command types, plan types, param refs | `2-sql/1-core` |
| `6-adapter` | adapters | Lowers `MongoCommand` → `MongoWireCommand` (resolves param refs) | `2-sql/6-adapters` (SQL AST → SQL string) |
| `7-driver` | drivers | Wraps `MongoClient`, dispatches wire commands to `mongodb` driver | `2-sql/7-drivers` (sends SQL to Postgres) |
| `5-runtime` | runtime | Orchestrates adapter + driver, wraps results | `2-sql/5-runtime` |

The domain number `2-mongo` places MongoDB as a peer to `2-sql`, which is architecturally correct — both are database family domains at the same level, importing only from `1-framework`.

### Architecture config changes

- The former `document` domain is renamed to `mongo`. This is a narrowing — `document` was a general term; `mongo` is specific. If a second document database (e.g. DynamoDB) is added later, the domain structure will need revisiting. For a PoC this is fine — premature generalization here would be worse.
- Layer order for `mongo` is `["core", "runtime", "adapters", "drivers"]` — a subset of SQL's fuller layer list (no `authoring`, `tooling`, `lanes` yet). This will grow as milestones 2–3 add the query surface.

### Dependency graph

```
1-framework/1-core (contract types: PlanMeta, DocumentContract)
1-framework/4-runtime-executor (AsyncIterableResult)
  ↑
  │
2-mongo/1-core ← 2-mongo/6-adapter ← 2-mongo/5-runtime
                                          ↓
                    2-mongo/7-driver ←────┘
```

This is a clean DAG. The runtime depends on all three other packages; the driver and adapter each depend only on core; core depends only on framework.

---

## Boundary correctness

### Domain boundaries

**Good:** No imports from `2-sql/*` or `3-extensions/*`. The architecture config enforces `mongo.mayImportFrom: ["framework"]`.

**Observation:** The adapter accepts `MongoLoweringContext` containing a `DocumentContract`, but currently ignores it (the `_context` parameter is unused in `lower()`). This is plumbing for milestone 2 when the contract will be needed for type-aware lowering. The interface is forward-looking; the implementation is minimal.

### Layer boundaries — dependency inversion needed (blocking)

The layer order in `architecture.config.json` is `["core", "runtime", "adapters", "drivers"]` — `runtime` is numbered `5`, before `6-adapter` and `7-driver`. But `5-runtime` has **production dependencies** on both `@prisma-next/mongo-adapter` (`6-adapter`) and `@prisma-next/mongo-driver` (`7-driver`). This is a lower-numbered package depending on higher-numbered ones — the opposite of the convention.

The SQL domain has the same inversion (`2-sql/5-runtime` depends on `2-sql/6-adapters` and `2-sql/7-drivers`).

**Assessment:** The fix is dependency inversion, not renumbering. Inspection of `5-runtime/src/mongo-runtime.ts` shows it imports only **interfaces** (`type MongoAdapter`, `type MongoLoweringContext`, `type MongoDriver`) from the adapter and driver packages — never concrete implementations. The concrete factories (`createMongoAdapter`, `createMongoDriver`) are only used in test code (`test/helpers.ts`), which is `devDependencies`.

The fix:
1. Move `MongoAdapter`, `MongoLoweringContext`, and `MongoDriver` interfaces into `1-core` (they already depend only on types from `1-core`: `MongoQueryPlan`, `MongoExecutionPlan`, `MongoWireCommand`).
2. Remove `@prisma-next/mongo-adapter` and `@prisma-next/mongo-driver` from `5-runtime/package.json` production `dependencies` (keep as `devDependencies` for tests).
3. `5-runtime/src/mongo-runtime.ts` imports interfaces from `@prisma-next/mongo-core` instead.
4. Update `architecture.config.json` layer order to `["core", "runtime", "adapters", "drivers"]` (already correct after the fix — runtime depends only on core).

Result: `5-runtime` depends only on `1-core` and `1-framework` at the production level. The numbering `1 < 5 < 6 < 7` is correct — higher-numbered packages depend downward, runtime accepts adapter/driver via constructor injection.

The SQL domain has the same issue and should be corrected as a follow-up.

### Plane boundaries

- `1-core` and `6-adapter` are `plane: "shared"` — correct, they have no runtime-only dependencies.
- `5-runtime` and `7-driver` are `plane: "runtime"` — correct, they depend on `mongodb` (a runtime dependency).

---

## Design decisions

### Two-level command hierarchy (MongoCommand / MongoWireCommand)

The design doc initially suggested that "queries are already structured objects — the command IS the wire format, so there's no lowering step." The implementation diverges: it introduces `MongoParamRef` to carry values with codec metadata, and the adapter resolves refs to plain values. This creates a clear separation between plan-construction time (where you know the codec ID and param name) and execution time (where you need resolved values).

**Assessment:** This is a good decision. It mirrors the SQL path (`SqlQueryPlan` with `SqlParamRef` → `ExecutionPlan` with resolved params), keeps the lowering step as the natural place for codec encoding (not implemented yet, but the hook point exists), and makes the command immutable at construction time via `Object.freeze()`.

### Class hierarchy with `instanceof` dispatch (blocking — must change)

Both `MongoCommand` and `MongoWireCommand` use abstract base classes with concrete subclasses (`FindCommand`, `InsertOneCommand`, etc.), and dispatch in the adapter and driver uses `instanceof` checks. The design doc raised the question: "Should `MongoCommand` be a discriminated union?" The implementation chose classes without `kind` discriminants.

This must be corrected. The SQL AST establishes the pattern: each concrete class has a `readonly kind = 'find' as const` discriminant, the abstract base classes are module-private (not exported), and consumers use union types (`AnyMongoCommand = FindCommand | InsertOneCommand | ...`). Dispatch uses `switch (command.kind)` with exhaustive `never` checks — the compiler catches missing cases at build time.

**Problems with `instanceof` dispatch:**
- No compile-time exhaustiveness — adding a new command subclass silently falls through to a runtime `throw`.
- `instanceof` breaks across realm boundaries (multiple copies of the package) and across serialization (if plans ever cross process boundaries).
- Exporting the abstract base class leaks an implementation detail and lets consumers type things as `MongoCommand` instead of the union.

**Required changes:**
1. Add `readonly kind` to each concrete command class (e.g. `kind: 'find'`, `kind: 'insertOne'`).
2. Define union types: `type AnyMongoCommand = FindCommand | InsertOneCommand | ...` (and same for wire commands).
3. Make the abstract base classes module-private (not exported).
4. Replace all `instanceof` dispatch with `switch (command.kind)` + exhaustive `never` checks.
5. Use `AnyMongoCommand` in `MongoQueryPlan` and adapter/driver interfaces.

See also code review F01.

### PlanMeta reuse

`PlanMeta` is used as-is with SQL-specific fields left empty. The stub in tests is:

```typescript
const stubMeta: PlanMeta = {
  target: 'mongo',
  storageHash: 'test-hash',
  lane: 'mongo',
  paramDescriptors: [],
};
```

`paramDescriptors` is empty (Mongo values are inline), `refs` and `projection` are omitted (optional fields). This works today because the runtime doesn't inspect these fields — it just passes the plan to the adapter and driver. When plugins or verification are added, the mismatch may become real.

**Assessment:** Correct pragmatic decision for M1. The spec already flags this for later resolution.

---

## Test strategy adequacy

### What must be proven

1. Each operation type (`find`, `insertOne`, `updateOne`, `deleteOne`, `aggregate`) flows through the full pipeline and returns correct results.
2. The adapter correctly resolves `MongoParamRef` values (including nested expressions).
3. The driver dispatches to the correct `mongodb` driver method.

### What is tested

- **Adapter unit tests** (`6-adapter/test/mongo-adapter.test.ts`): 7 tests covering all 5 command types + nested param refs + options preservation. Good coverage of the lowering logic.
- **Integration tests** (`5-runtime/test/*.test.ts`): 8 tests across 5 files, each exercising the full pipeline (command construction → runtime → adapter → driver → mongodb-memory-server). Tests seed data via the `mongodb` driver directly, then verify through the pipeline.

### Gaps

- **No unit tests for the driver.** The driver is only tested through integration tests. A unit test with a mocked `Db` would catch dispatch errors without needing `mongodb-memory-server`.
- **No error/edge-case tests.** What happens when the collection doesn't exist? When the filter matches nothing for `updateOne`/`deleteOne`? When the aggregation pipeline is empty? When `MongoClient.connect()` fails? These are secondary for a PoC but worth noting.
- **No test for unknown command type.** Both the adapter and driver throw on unknown command types — neither throw path is tested.

---

## Risks and open items

1. **Dependency direction violation.** `5-runtime` has production dependencies on `6-adapter` and `7-driver`. Fix via dependency inversion: move interfaces to `1-core`, remove production deps from runtime (see Layer boundaries above). The SQL domain has the same issue — follow-up.

2. **`document` → `mongo` domain rename.** If other code referenced the `document` domain name, the rename could break things. Since no `document` domain packages existed before this branch, the risk is low.

3. **`mongodb-memory-server` CI cost.** Downloads a ~100MB `mongod` binary. The spec acknowledges this (cached after first download). CI configuration may need to cache this binary to avoid slow first runs.

4. **No `MongoContract` type yet.** The adapter's `MongoLoweringContext` currently uses `DocumentContract` from the framework — a generic type. Milestone 2 will introduce the specific `MongoContract`. This is fine for M1 since the context is unused.

5. **`3-extensions` renumbering deferred.** The plan notes that `3-extensions` occupying the same domain number space as `3-mongo` (now `2-mongo`) could cause issues. The rename to `2-mongo` sidesteps this, but `3-extensions`'s import rules now reference `mongo` instead of `document`. If `3-extensions` code actually imports from `document`-domain packages, it would need updating.
