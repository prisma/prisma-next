# MongoDB Workstream — Next Steps

**Context**: The retail store example app (PR #327) stress-tested the Mongo target end-to-end and surfaced framework gaps documented in [projects/mongo-example-apps/framework-limitations.md](../../../projects/mongo-example-apps/framework-limitations.md). This plan consolidates those gaps with incomplete items from the [ORM consolidation](../../../projects/orm-consolidation/plan.md) and [schema migrations](../../../projects/mongo-schema-migrations/plan.md) project plans into a sequenced set of work areas.

**Linear project**: [WS4: MongoDB & Cross-Family Architecture](https://linear.app/prisma-company/project/ws4-mongodb-and-cross-family-architecture-89d4dcdbcd9a)

---

## Status snapshot (as of 2026-04-13)

### ORM Consolidation

| Phase | Status | Linear | Notes |
|---|---|---|---|
| Phase 1 (Mongo Collection spike) | Done | TML-2189 | |
| Phase 1.5 M1-M3 (write ops, demo, tests) | Done | TML-2194 | |
| Phase 1.5 M4 (dot-path mutations `$push`/`$pull`/`$inc`) | **Deferred** | — | No ticket. Maps to FL-04. |
| Phase 1.5 M5 (unified query plan) | Done | | |
| Phase 1.6 (codec-owned value serialization) | Done | TML-2202 | |
| Phase 1.75a (typed JSON simplification) | Done | TML-2204 | Sub-task TML-2229 (no-emit path) still open, Urgent. |
| Phase 1.75b (polymorphism) | Done | TML-2205, TML-2227 | |
| Phase 1.75c (value objects & embedded docs) | Done | TML-2206 | `@@owner` in PSL not implemented (FL-12). |
| Phase 2 (shared interface extraction) | Not started | TML-2213 | Assigned to Alexey. |
| Phase 2.5 (pipeline builder) | Done | M9 milestone | |
| Layering reorganization | Done | TML-2201 | |

### Schema Migrations

| Milestone | Status | Linear | Notes |
|---|---|---|---|
| M1 tasks 1.1–1.8 (SPI, types, IR, DDL, planner) | Done | TML-2220 | |
| M1 tasks 1.9–1.13 (runner, marker, wiring, E2E, demo) | **Not done** | — | Runner and target wiring never implemented. |
| M2 (full vocabulary + validators + PSL) | Done per Linear | TML-2231 | Has bugs: FL-09, FL-10, FL-11. |
| M3 (polymorphic indexes) | Not started | TML-2232 | |
| M4 (online CLI + live introspection) | In Progress | TML-2233 | |
| Data migrations | Not started | TML-2219 | Depends on WS1 (Saevar). |
| Manual migrations | Not started | TML-2244 | Depends on WS1 (Saevar). |

### Example Apps (M10)

| App | Status | Linear | Notes |
|---|---|---|---|
| Retail store | Merging | TML-2185 | PR #327 ready to merge. |
| Predictive maintenance | Not started | TML-2186 | Blocked on framework gaps. |

### Closeout Backlog

| Item | Status | Linear | Priority |
|---|---|---|---|
| No-emit path parameterized types | To-do | TML-2229 | Urgent |
| DML visitor pattern | To-do | TML-2234 | Low |
| Close out pipeline builder project | Backlog | TML-2236 | |
| Close out ORM consolidation project | Backlog | TML-2237 | |

---

## Framework limitations discovered by retail store

Full details in [projects/mongo-example-apps/framework-limitations.md](../../../projects/mongo-example-apps/framework-limitations.md).

| ID | Issue | Area |
|---|---|---|
| FL-01 | Scalar codec output types not assignable to `string`/`number` | Type ergonomics |
| FL-02 | `_id` codec output type not assignable to `string` | Type ergonomics |
| FL-03 | Timestamp codec type incompatible with `Date`/`string` | Type ergonomics |
| FL-04 | No typed `$push`/`$pull`/`$inc` | ORM mutations |
| FL-05 | Pipeline/raw results untyped | Query results |
| FL-06 | ObjectId filter requires manual `MongoParamRef` wrapping | ORM queries |
| FL-07 | No `$vectorSearch` in pipeline builder | Extension (deferred) |
| FL-08 | 1:N back-relation loading not available/tested | ORM queries |
| FL-09 | Migration planner creates separate collections for variants | Migration bugs |
| FL-10 | Variant collection validators incomplete | Migration bugs |
| FL-11 | `$jsonSchema` drops Float fields | Migration bugs |
| FL-12 | Embedded models via `@@owner` not in PSL | Schema authoring |
| FL-13 | TS DSL for Mongo not available | Schema authoring (WS2) |
| FL-14 | Change streams | Future (WS3 VP5) |
| FL-15 | Atlas Search requires extension pack | Future |

---

## Work areas (sequenced)

### Area 1: Mongo type ergonomics (FL-01, FL-02, FL-03, TML-2229)

**Linear**: [TML-2245](https://linear.app/prisma-company/issue/TML-2245)

**Priority: Highest.** ~60 type casts in the retail store. Every ORM-to-application boundary is broken.

**Root cause**: The codec type map resolves `mongo/string@1`, `mongo/objectId@1`, and `mongo/dateTime@1` to opaque branded types instead of their underlying TypeScript primitives. The runtime values *are* the expected primitives — the types don't reflect that.

**Scope**:

- Fix Mongo scalar codec output types (`mongo/string@1` → `string`, `mongo/int32@1` → `number`, etc.)
- Fix `mongo/objectId@1` output type to be assignable to `string`
- Fix `mongo/dateTime@1` output type to be assignable to `Date` (or `string`, depending on what the codec actually returns at runtime)
- Complete TML-2229: restore parameterized output types in the no-emit path

**Proof**: The retail store compiles with zero `as string` / `as unknown as string` / `String()` casts on ORM results.

**Depends on**: Nothing.

**Blocks**: Area 2 benefits from this (fewer workarounds in where clauses).

### Area 2: ORM query and mutation ergonomics (FL-04, FL-06, FL-08)

**Linear**: [TML-2246](https://linear.app/prisma-company/issue/TML-2246)

**Priority: High.** Users drop to `mongoRaw` for the most common mutation patterns.

**Scope**:

- **FL-04**: Implement dot-path field accessor mutations — `$push`, `$pull`, `$inc`, `$set` on nested paths via `u("field.path")` (deferred Phase 1.5 M4). Maps to [ADR 180](../../architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md).
- **FL-06**: ORM `where()` should auto-encode ObjectId-typed fields. When a contract field has `codecId: 'mongo/objectId@1'`, the ORM should wrap the value in `MongoParamRef` automatically instead of requiring the user to construct it manually.
- **FL-08**: Validate and test 1:N back-relation loading via `include()`. If it works, add test coverage. If it doesn't, implement it.

**Proof**: The retail store's `mongoRaw` calls for cart add/remove and order status update are replaced with ORM `update()` calls. ObjectId filter helpers (`objectIdEq()`) are removed.

**Depends on**: Area 1 (type fixes reduce noise, but not a hard blocker).

### Area 3: Migration planner bugs (FL-09, FL-10, FL-11)

**Linear**: [TML-2247](https://linear.app/prisma-company/issue/TML-2247)

**Priority: High.** Bugs in completed M2 work that produce incorrect migration operations.

**Scope**:

- **FL-09 + FL-10**: Fix polymorphic variant collection handling. Variant models that share their base model's collection (via `@@map` or implicit STI) must not produce separate `createCollection` operations. Validators for the shared collection must include all base + variant fields, not just variant-specific fields.
- **FL-11**: Fix `$jsonSchema` derivation to recognize `Float` scalar type. Fields typed as `Float` should produce `{ bsonType: "double" }` in the validator.

**Proof**: Running `migration plan` on the retail store contract produces correct operations — no spurious variant collections, validators include all fields, Float fields are present.

**Depends on**: Nothing.

**Blocks**: Area 4 (M3 polymorphic indexes depend on correct variant handling).

### Area 4: Migration system completion (M1 runner + wiring, M3, M4)

**Linear**: [TML-2248](https://linear.app/prisma-company/issue/TML-2248)

**Priority: Medium.** The planner generates operations but they can't be applied.

**Scope**:

- **M1 tasks 1.9–1.11**: Implement `MongoMigrationRunner` (three-phase loop: precheck → execute → postcheck), marker/ledger in `_prisma_migrations` collection, wire Mongo target descriptor.
- **M1 tasks 1.12–1.13**: End-to-end proof (plan + apply single index against `mongodb-memory-server`), add migrations to example app.
- **M3** (TML-2232): Polymorphic partial index derivation — auto-generate `partialFilterExpression` scoped to discriminator values for variant-specific indexes.
- **M4** (TML-2233, already in progress): Online CLI commands + live introspection — `db init`, `db update`, `db verify`, `db sign`, `db schema`, `migration status --db`, `migration show`.

**Note**: Data migrations (TML-2219) and manual migrations (TML-2244) depend on WS1 (Saevar's migration system work on VP1/VP2). They are not sequenced here.

**Proof**: `migration plan` + `migration apply` works end-to-end against a real MongoDB instance for the retail store contract. Polymorphic collections get partial indexes.

**Depends on**: Area 3 (bug fixes must land first).

### Area 5: Pipeline and raw query result typing (FL-05)

**Linear**: [TML-2249](https://linear.app/prisma-company/issue/TML-2249)

**Priority: Medium.** All pipeline/raw results are `unknown`, requiring manual type assertions.

**Scope**:

- Pipeline builder `build()` should produce a `MongoQueryPlan` that carries the inferred result type from the document shape tracking.
- `runtime.execute()` should propagate the result type from the query plan.
- `rawPipeline()` remains untyped (user asserts the return type) but should accept a type parameter for the result.

**Proof**: A pipeline builder chain like `.match(...).group(...).build()` produces a plan whose execution returns typed results without `as` casts.

**Depends on**: Nothing (can run in parallel with Areas 1-4).

### Area 6: Schema authoring gaps (FL-12, FL-13)

**Linear**: [TML-2250](https://linear.app/prisma-company/issue/TML-2250)

**Priority: Lower.** Missing PSL features that limit what the example app can demonstrate.

**Scope**:

- **FL-12**: Add `@@owner` attribute to the Mongo PSL interpreter, enabling embedded entity declarations (as distinct from value objects). The contract schema and emitter already support `owner` — the gap is only in PSL authoring and ORM embedded entity CRUD.
- **FL-13**: TypeScript DSL for Mongo contract authoring. This depends on WS2 (Alberto's contract authoring workstream) delivering the new TS authoring surface. Not actionable until that surface exists.

**Proof (FL-12)**: A PSL schema can declare `model Comment { ... @@owner(Post) }` and the emitter produces a contract with the correct owner/embed relation.

**Depends on**: FL-13 depends on WS2.

---

## Sequencing

```
                                 ┌─ Area 5 (pipeline typing) ── parallel
                                 │
Area 1 (type ergonomics) ───┐    ├─ Area 6 (schema authoring) ── parallel
                             ├───┤
Area 3 (migration bugs) ────┘    └─ Area 4 (migration completion)
                                       │
Area 2 (ORM ergonomics) ────────────── │ ── can overlap with Area 1
                                       │
                                       ▼
                              TML-2186 (predictive maintenance app)
                                       │
                                       ▼
                              Shared ORM interface (M8, with Alexey)
```

- **Areas 1 and 3** are independent and can start immediately in parallel.
- **Area 2** benefits from Area 1 landing but is not blocked by it.
- **Area 4** is blocked by Area 3 (migration bugs must be fixed first).
- **Areas 5 and 6** are independent and can run in parallel with everything.
- **TML-2186** (predictive maintenance app) validates fixes end-to-end; sequence after Areas 1-3.
- **M8** (shared ORM interface, Alexey) remains the final phase.

---

## Deferred (not in this sequence)

| Item | Reason |
|---|---|
| FL-07 ($vectorSearch) | Requires Atlas extension pack — separate project. |
| FL-14 (change streams) | Requires streaming subscription support (WS3 VP5). |
| FL-15 (Atlas Search) | Requires extension pack — separate project. |
| TML-2234 (DML visitor pattern) | Low-priority cleanup. |
| TML-2219 (data migrations) | Depends on WS1 VP1 (Saevar). |
| TML-2244 (manual migrations) | Depends on WS1 VP2 (Saevar). |
