# Mongo Execution PoC Plan

## Summary

Build the minimal Mongo execution pipeline — `MongoQueryPlan`, `MongoDriver`, `MongoRuntimeCore` — prove it works against a real MongoDB instance, then add codecs and an independent `MongoContract` (structurally symmetric with `SqlContract`, not inheriting from it), and finally a basic typed query surface with row type inference. Success: a typed query on a `users` collection flows through the full pipeline and returns correctly-typed results.

**Spec:** `projects/mongo-execution-poc/spec.md`
**Linear:** [Mongo PoC](https://linear.app/prisma-company/project/mongo-poc-89d4dcdbcd9a) — keep Linear in sync as tasks progress, scope changes, or milestones complete.

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will Madden | Drives execution |

## Milestones

### Milestone 1: Execution pipeline against a real MongoDB

Build the three core components and prove they work end-to-end with hardcoded queries against `mongodb-memory-server`. No contract types, no type inference — just the runtime machinery.

**Tasks:**

- [x] **Scaffold `packages/2-mongo/` domain** — create the package directory structure (`1-core/`, `5-runtime/`, `6-adapter/`, `7-driver/`), `package.json` files, `tsconfig.json`, vitest config. Register in the workspace root `pnpm-workspace.yaml`.
- [x] **Define `MongoCommand` discriminated union** — `FindCommand`, `InsertOneCommand`, `UpdateOneCommand`, `DeleteOneCommand`, `AggregateCommand`, each with exactly the fields it needs. Lives in `2-mongo/1-core/`.
- [x] **Define `MongoQueryPlan`** — pairs `MongoCommand` with `PlanMeta` and a `_row` phantom type. Reuse `PlanMeta` from `1-framework/1-core/` (with SQL-specific fields left empty/unused). Lives in `2-mongo/1-core/`.
- [x] **Set up `mongodb-memory-server`** — add the dependency, create a shared test setup that starts a replica set `mongod`, provides a connection URI, and tears down after tests. Lives in `2-mongo/` test infrastructure.
- [x] **Implement `MongoDriver`** — wraps `MongoClient`, dispatches `MongoCommand` variants to the correct `mongodb` driver method (`collection.find()`, `insertOne()`, etc.), returns `AsyncIterable`. Lives in `2-mongo/7-driver/`.
- [x] **Implement `MongoRuntimeCore`** — validates the plan, calls the driver, wraps results in `AsyncIterableResult<Row>`. No plugin hooks — direct driver calls. Lives in `2-mongo/5-runtime/`.
- [x] **Integration tests: hardcoded queries** — tests that construct `MongoQueryPlan` objects by hand (no contract, no query surface), execute through `MongoRuntimeCore` → `MongoDriver` → `mongodb-memory-server`, and assert correct results. Cover `find`, `insertOne`, `updateOne`, `deleteOne`, and `aggregate` with a raw pipeline.

### Milestone 2: Codecs and contract types

Build Mongo codecs first (the type map foundation), then design an independent `MongoContract` type that is structurally symmetric with `SqlContract` — same patterns for how models reference fields, fields reference codecs, and mappings connect domain names to storage names. Do NOT modify `ContractBase` or import from `2-sql`; instead, keep the shapes parallel so the common elements can be extracted to the framework domain later.

**Detailed plan:** [`projects/mongo-execution-poc/plans/m2-codecs-contract-plan.md`](plans/m2-codecs-contract-plan.md)

**Tasks:**

- [ ] Define `MongoCodec` interface and `MongoCodecRegistry` (parallel to SQL)
- [ ] Decide ObjectId representation (`string` vs. driver `ObjectId`)
- [ ] Implement base Mongo codecs with unit tests (`objectId`, `string`, `int32`, `boolean`, `date`)
- [ ] Define `MongoContract` type structure (`MongoStorage`, `MongoStorageCollection`, `MongoStorageField`, `MongoModelDefinition`, `MongoMappings`) — independent of `SqlContract` but structurally symmetric
- [ ] Define `MongoTypeMaps` and `MongoContractWithTypeMaps` (phantom key pattern)
- [ ] Update `MongoLoweringContext` to reference `MongoContract`
- [ ] Hand-craft `contract.d.ts` for blog platform schema (Users, Posts with embedded Comments, User→Posts reference)
- [ ] Hand-craft `contract.json` matching the `.d.ts` types
- [ ] Integration test: contract-driven plan with `Row` inferred from contract, executed against `mongodb-memory-server`
- [ ] Document structural symmetry (convergence/divergence table)

### Milestone 3: Typed query surface with row type inference

Build a thin typed layer that reads the contract types and constructs `MongoQueryPlan` objects with the `Row` type inferred from the contract. Then run the full flow end-to-end.

**Tasks:**

- [ ] **Implement the query surface** — a factory or set of functions that accept contract type information and produce `MongoQueryPlan` objects. E.g. `find(collection, filter, options)` → `MongoQueryPlan<Row>` where `Row` is inferred from the contract's model type for that collection. Lives in `2-mongo/` (package TBD — possibly `4-lanes/`).
- [ ] **Row type inference from contract** — the `Row` phantom type on the returned plan must be inferred from the contract's `CodecTypes` and model definitions, not manually specified by the caller. A `find` on `users` returns `MongoQueryPlan<User>` where `User` is derived from the contract.
- [ ] **Integration tests: full flow** — tests that use the query surface to construct a plan from the hand-crafted contract, execute through the runtime and driver against `mongodb-memory-server`, and assert typed results. This is the end-to-end acceptance test.
- [ ] **Type-level tests for inference** — TypeScript files that verify: calling `find` on `users` returns a plan with the correct `Row` type, calling `insertOne` returns a plan with the correct acknowledgment type.

### Milestone 4: Close-out

- [ ] Verify all acceptance criteria from `projects/mongo-execution-poc/spec.md` are met
- [ ] Document any design decisions made during implementation (PlanMeta reuse, ObjectId representation, MongoCommand union shape, codec registry shape) in the Mongo design docs
- [ ] Verify no `2-mongo` package imports from `2-sql/*` or `3-extensions/*`
- [ ] Verify structural symmetry between `MongoContract` and `SqlContract` is documented (convergence/divergence table)
- [ ] Migrate any long-lived documentation into `docs/planning/mongo-target/`
- [ ] Strip repo-wide references to `projects/mongo-execution-poc/**`
- [ ] Delete `projects/mongo-execution-poc/`

## Test Coverage

| Acceptance Criterion | Test Type | Milestone | Notes |
|---|---|---|---|
| `find` on `users` executes through runtime/driver and returns correct rows | Integration | M1 | Hardcoded plan, `mongodb-memory-server` |
| `insertOne`, `updateOne`, `deleteOne` execute and return correct results | Integration | M1 | Hardcoded plans, verify return shapes |
| `aggregate` with raw pipeline executes and returns results | Integration | M1 | Hardcoded pipeline |
| Driver dispatches to correct `mongodb` method per operation | Integration | M1 | Covered by the operation-specific tests |
| Mongo codec registry with base codecs follows SQL registry shape | Unit + Type-level | M2 | encode/decode round-trip, type-level check |
| `contract.json` and `contract.d.ts` exist with embedded + referenced relations | Manual | M2 | File existence, review |
| Contract-driven plan executes with `Row` inferred from contract | Integration | M2 | Hand-built plan using contract types, `mongodb-memory-server`; compilation proves types work |
| `MongoContract` is structurally symmetric with `SqlContract` | Manual + Type-level | M2 | Documented convergence/divergence, compile-time check |
| Query surface constructs plan with `Row` inferred from contract | Type-level + Integration | M3 | Type-level tests + runtime execution |
| Full flow: query surface → plan → runtime → driver → typed results | Integration | M3 | End-to-end test against `mongodb-memory-server` |
| No `2-mongo` imports from `2-sql/*` or `3-extensions/*` | Automated | M4 | `pnpm lint:deps` |
| `PlanMeta` reused or decision documented | Manual | M4 | Review |

## Open Items

- **`ObjectId` representation** — normalize to `string` or preserve the driver's `ObjectId` class? Decision deferred to M2 (codec definition). Either works for the PoC; the choice affects every downstream consumer.
- **Package layout within `2-mongo/`** — currently `1-core/`, `5-runtime/`, `6-adapter/`, `7-driver/`. The query surface package (M3) may land in `4-lanes/` or stay in `5-runtime/` — decide during implementation.
- **`3-extensions` renumbering** — if `pnpm lint:deps` flags `2-mongo` importing from `1-framework` as a layering violation due to `3-extensions` occupying the same domain number, renumber `3-extensions` to `9-extensions`. Defer until the issue actually manifests.

## Decisions

- **Codecs first in M2** — build the codec registry before the contract type, since `CodecTypes` are the foundation that the contract's type system references.
- **Independent `MongoContract`** — do not extend `ContractBase` or modify existing contract types. Build `MongoContract` independently, keeping its structure parallel to `SqlContract`, then extract the common elements to the framework domain in a follow-on step. This follows the "spike then extract" approach and avoids premature generalization.
- **Structural symmetry as a requirement** — `MongoContract` must use the same patterns as `SqlContract` (models → fields → codec IDs → CodecTypes, storage mappings). Divergence points (embedded documents, collections vs tables) must be documented to prepare for the extraction step.
