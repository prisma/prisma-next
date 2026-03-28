# Mongo Execution PoC Plan

## Summary

Build the minimal Mongo execution pipeline — `MongoQueryPlan`, `MongoDriver`, `MongoRuntimeCore` — prove it works against a real MongoDB instance, then add hand-crafted contract types and a basic typed query surface with row type inference. Success: a typed query on a `users` collection flows through the full pipeline and returns correctly-typed results.

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

- [ ] **Scaffold `packages/3-mongo/` domain** — create the package directory structure (`1-core/`, `5-runtime/`, `6-adapters/`), `package.json` files, `tsconfig.json`, vitest config. Register in the workspace root `pnpm-workspace.yaml`. Verify `pnpm lint:deps` doesn't flag `3-mongo` (if it does, note the issue for later `3-extensions` renumbering).
- [ ] **Define `MongoCommand` discriminated union** — `FindCommand`, `InsertOneCommand`, `UpdateOneCommand`, `DeleteOneCommand`, `AggregateCommand`, each with exactly the fields it needs. Lives in `3-mongo/1-core/`.
- [ ] **Define `MongoQueryPlan`** — pairs `MongoCommand` with `PlanMeta` and a `_row` phantom type. Reuse `PlanMeta` from `1-framework/1-core/` (with SQL-specific fields left empty/unused). Lives in `3-mongo/1-core/`.
- [ ] **Set up `mongodb-memory-server`** — add the dependency, create a shared test setup that starts a replica set `mongod`, provides a connection URI, and tears down after tests. Lives in `3-mongo/` test infrastructure.
- [ ] **Implement `MongoDriver`** — wraps `MongoClient`, dispatches `MongoCommand` variants to the correct `mongodb` driver method (`collection.find()`, `insertOne()`, etc.), returns `AsyncIterable`. Lives in `3-mongo/6-adapters/`.
- [ ] **Implement `MongoRuntimeCore`** — validates the plan, calls the driver, wraps results in `AsyncIterableResult<Row>`. No plugin hooks — direct driver calls. Lives in `3-mongo/5-runtime/`.
- [ ] **Integration tests: hardcoded queries** — tests that construct `MongoQueryPlan` objects by hand (no contract, no query surface), execute through `MongoRuntimeCore` → `MongoDriver` → `mongodb-memory-server`, and assert correct results. Cover `find`, `insertOne`, `updateOne`, `deleteOne`, and `aggregate` with a raw pipeline.

### Milestone 2: Contract types for the blog platform schema

Hand-craft `contract.json` and `contract.d.ts` for the blog platform example schema. The contract must contain the information the query surface needs to construct `MongoQueryPlan` objects with correct types.

**Tasks:**

- [ ] **Define `MongoContract` type** — extends `ContractBase` with Mongo-specific storage information (collections, embedded document structure, field-to-collection mappings). Lives in `3-mongo/1-core/`.
- [ ] **Define Mongo `CodecTypes`** — a type map from codec IDs to TS types for base Mongo types (`mongo/objectId@1`, `mongo/string@1`, `mongo/int32@1`, `mongo/boolean@1`, `mongo/date@1`). Decide on `ObjectId` representation (string vs. driver class).
- [ ] **Hand-craft `contract.d.ts`** — typed contract for the blog platform schema: `Users` (with embedded `Address`), `Posts` (with embedded `Comments` array), referenced `User→Posts` relationship. Models, fields with codec IDs, embedded document structure, collection mappings.
- [ ] **Hand-craft `contract.json`** — runtime contract data matching the `.d.ts` types. Collection names, field definitions, embedded document descriptors.
- [ ] **Type-level tests** — TypeScript files that must typecheck: verify the contract types carry collection names, field types resolve through `CodecTypes`, embedded document fields are accessible. No running database needed.

### Milestone 3: Typed query surface with row type inference

Build a thin typed layer that reads the contract types and constructs `MongoQueryPlan` objects with the `Row` type inferred from the contract. Then run the full flow end-to-end.

**Tasks:**

- [ ] **Implement the query surface** — a factory or set of functions that accept contract type information and produce `MongoQueryPlan` objects. E.g. `find(collection, filter, options)` → `MongoQueryPlan<Row>` where `Row` is inferred from the contract's model type for that collection. Lives in `3-mongo/` (package TBD — possibly `4-lanes/`).
- [ ] **Row type inference from contract** — the `Row` phantom type on the returned plan must be inferred from the contract's `CodecTypes` and model definitions, not manually specified by the caller. A `find` on `users` returns `MongoQueryPlan<User>` where `User` is derived from the contract.
- [ ] **Integration tests: full flow** — tests that use the query surface to construct a plan from the hand-crafted contract, execute through the runtime and driver against `mongodb-memory-server`, and assert typed results. This is the end-to-end acceptance test.
- [ ] **Type-level tests for inference** — TypeScript files that verify: calling `find` on `users` returns a plan with the correct `Row` type, calling `insertOne` returns a plan with the correct acknowledgment type.

### Milestone 4: Close-out

- [ ] Verify all acceptance criteria from `projects/mongo-execution-poc/spec.md` are met
- [ ] Document any design decisions made during implementation (PlanMeta reuse, ObjectId representation, MongoCommand union shape) in the Mongo design docs
- [ ] Verify no `3-mongo` package imports from `2-sql/*` or `3-extensions/*`
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
| `contract.json` and `contract.d.ts` exist with embedded + referenced relations | Manual | M2 | File existence, review |
| Contract type structure contains info to build query plans | Type-level | M2 | `.ts` files that must typecheck |
| `MongoContract` extends `ContractBase` | Type-level | M2 | Compile-time check |
| Query surface constructs plan with `Row` inferred from contract | Type-level + Integration | M3 | Type-level tests + runtime execution |
| Full flow: query surface → plan → runtime → driver → typed results | Integration | M3 | End-to-end test against `mongodb-memory-server` |
| No imports from `2-sql/*` or `3-extensions/*` | Automated | M4 | `pnpm lint:deps` |
| `PlanMeta` reused or decision documented | Manual | M4 | Review |

## Open Items

- **`ObjectId` representation** — normalize to `string` or preserve the driver's `ObjectId` class? Decision deferred to M2 (codec definition). Either works for the PoC; the choice affects every downstream consumer.
- **Package layout within `3-mongo/`** — the spec assumes `1-core/`, `5-runtime/`, `6-adapters/`, parallel to `2-sql/`. The query surface package (M3) may land in `4-lanes/` or stay in `5-runtime/` — decide during implementation.
- **`3-extensions` renumbering** — if `pnpm lint:deps` flags `3-mongo` importing from `1-framework` as a layering violation due to `3-extensions` occupying the same domain number, renumber `3-extensions` to `9-extensions`. Defer until the issue actually manifests.
