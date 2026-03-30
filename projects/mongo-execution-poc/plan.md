# Mongo Execution PoC Plan

## Summary

Build the minimal Mongo execution pipeline — `MongoQueryPlan`, `MongoDriver`, `MongoRuntimeCore` — and prove it works against a real MongoDB instance with codecs and an independent `MongoContract`. This project proved the execution machinery works and informed the contract redesign. The typed query surface and ORM client are a follow-on project.

**Spec:** `projects/mongo-execution-poc/spec.md`
**Linear:** [Mongo PoC](https://linear.app/prisma-company/project/mongo-poc-89d4dcdbcd9a) — keep Linear in sync as tasks progress, scope changes, or milestones complete.

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will Madden | Drives execution |

## Milestones

### Milestone 1: Execution pipeline against a real MongoDB *(done)*

Build the three core components and prove they work end-to-end with hardcoded queries against `mongodb-memory-server`. No contract types, no type inference — just the runtime machinery.

**Tasks:**

- [x] **Scaffold `packages/2-mongo/` domain** — create the package directory structure (`1-core/`, `5-runtime/`, `6-adapter/`, `7-driver/`), `package.json` files, `tsconfig.json`, vitest config. Register in the workspace root `pnpm-workspace.yaml`.
- [x] **Define `MongoCommand` discriminated union** — `FindCommand`, `InsertOneCommand`, `UpdateOneCommand`, `DeleteOneCommand`, `AggregateCommand`, each with exactly the fields it needs. Lives in `2-mongo/1-core/`.
- [x] **Define `MongoQueryPlan`** — pairs `MongoCommand` with `PlanMeta` and a `_row` phantom type. Reuse `PlanMeta` from `1-framework/1-core/` (with SQL-specific fields left empty/unused). Lives in `2-mongo/1-core/`.
- [x] **Set up `mongodb-memory-server`** — add the dependency, create a shared test setup that starts a replica set `mongod`, provides a connection URI, and tears down after tests. Lives in `2-mongo/` test infrastructure.
- [x] **Implement `MongoDriver`** — wraps `MongoClient`, dispatches `MongoCommand` variants to the correct `mongodb` driver method (`collection.find()`, `insertOne()`, etc.), returns `AsyncIterable`. Lives in `2-mongo/7-driver/`.
- [x] **Implement `MongoRuntimeCore`** — validates the plan, calls the driver, wraps results in `AsyncIterableResult<Row>`. No plugin hooks — direct driver calls. Lives in `2-mongo/5-runtime/`.
- [x] **Integration tests: hardcoded queries** — tests that construct `MongoQueryPlan` objects by hand (no contract, no query surface), execute through `MongoRuntimeCore` → `MongoDriver` → `mongodb-memory-server`, and assert correct results. Cover `find`, `insertOne`, `updateOne`, `deleteOne`, and `aggregate` with a raw pipeline.

### Milestone 2: Codecs and contract types *(done)*

Built Mongo codecs and an independent `MongoContract` type, structurally symmetric with `SqlContract`. Proved contract-driven type inference works.

**Detailed plan:** [`projects/mongo-execution-poc/plans/m2-codecs-contract-plan.md`](plans/m2-codecs-contract-plan.md)

**Tasks:**

- [x] Define `MongoCodec` interface and `MongoCodecRegistry` (parallel to SQL)
- [x] Decide ObjectId representation (`string` vs. driver `ObjectId`) — normalized to `string`
- [x] Implement base Mongo codecs with unit tests (`objectId`, `string`, `int32`, `boolean`, `date`)
- [x] Define `MongoContract` type structure — independent of `SqlContract` but structurally symmetric
- [x] Define `MongoTypeMaps` and `MongoContractWithTypeMaps` (phantom key pattern)
- [x] Hand-craft `contract.d.ts` and `contract.json` for blog platform schema
- [x] Integration test: contract-driven plan with `Row` inferred from contract, executed against `mongodb-memory-server`
- [x] Document structural symmetry (convergence/divergence table)

### Milestone 3: Close-out *(superseded scope)*

The original M3 (typed query surface) and M4 (close-out) are superseded. The contract redesign discussion that followed M2 revealed that the most valuable next step is a minimal ORM client validating the redesigned contract structure — a different project with different acceptance criteria.

**What was learned** is documented in:
- [ADR 1 — Contract domain-storage separation](../../docs/planning/mongo-target/adrs/ADR%201%20-%20Contract%20domain-storage%20separation.md)
- [ADR 2 — Polymorphism via discriminator and variants](../../docs/planning/mongo-target/adrs/ADR%202%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)
- [ADR 3 — Aggregate roots and relation strategies](../../docs/planning/mongo-target/adrs/ADR%203%20-%20Aggregate%20roots%20and%20relation%20strategies.md)
- [Cross-cutting learnings](../../docs/planning/mongo-target/cross-cutting-learnings.md)
- [Contract symmetry](../../docs/planning/mongo-target/1-design-docs/contract-symmetry.md)

**Remaining close-out tasks:**

- [ ] Verify M1 and M2 acceptance criteria from spec are met
- [ ] Verify no `2-mongo-family` or `3-mongo-target` package imports from `2-sql/*` or `3-extensions/*`
- [ ] Verify `PlanMeta` reuse is documented
- [ ] Migrate any remaining long-lived documentation into `docs/planning/mongo-target/`

**Follow-on project**: The ORM client PoC will be a new project under `projects/` — see [mongo-poc-plan.md](../../docs/planning/mongo-target/1-design-docs/mongo-poc-plan.md) Phase 3 for the scope.

## Decisions

- **Codecs first in M2** — build the codec registry before the contract type, since `CodecTypes` are the foundation that the contract's type system references.
- **Independent `MongoContract`** — do not extend `ContractBase` or modify existing contract types. Build `MongoContract` independently, keeping its structure parallel to `SqlContract`, then extract the common elements to the framework domain in a follow-on step.
- **Structural symmetry as a requirement** — `MongoContract` must use the same patterns as `SqlContract` (models → fields → codec IDs → CodecTypes, storage mappings). Divergence points must be documented.
- **ObjectId normalized to `string`** — simpler, consistent with JSON serialization. Extension point for richer types later via codecs.
- **Original M3/M4 superseded** — the contract redesign discussion after M2 shifted the most valuable next step from "typed query surface" to "minimal ORM client with redesigned contract." This is a new project, not an extension of this one.
