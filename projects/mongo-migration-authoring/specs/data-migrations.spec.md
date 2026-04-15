# Summary

Users can express data transformations in MongoDB migrations — backfilling fields, reshaping documents, fixing constraint violations — alongside structural operations in the same migration file.

# Description

## The problem

MongoDB migrations today can only express structural DDL: create/drop collections, create/drop indexes, set validation rules. But schema evolution often requires changing data too. Adding a required `status` field to a `users` collection means you need to backfill `"active"` into every existing document before you can enforce the validator. Today, there's no way to express that backfill as part of the migration.

## What it looks like

A data transform is an operation in the migration's operation chain, alongside structural operations:

```typescript
// migrations/0002_backfill-status/migration.ts
import type { Contract } from './contract.d'
import contractJson from './contract.json' with { type: 'json' }
import { Migration, createCollection, setValidation, dataTransform }
  from '@prisma-next/target-mongo/migration'
import { mongoRaw } from '@prisma-next/mongo-orm'
import { mongoPipeline } from '@prisma-next/mongo-pipeline-builder'

const raw = mongoRaw({ contract: contractJson as Contract })
const agg = mongoPipeline<Contract>({ contractJson })

export default class extends Migration {
  plan() {
    return [
      createCollection("users", {
        validator: { $jsonSchema: { required: ["email"] } },
      }),

      dataTransform("backfill-status", {
        check: () => agg.from('users')
          .match((f) => f.status.exists(false))
          .limit(1),
        run: () => raw.collection('users')
          .updateMany({ status: { $exists: false } }, { $set: { status: "active" } }),
      }),

      setValidation("users", {
        $jsonSchema: { required: ["email", "status"] },
      }),
    ]
  }
}

Migration.run(import.meta.url, exports.default)
```

The ordering matters: create the collection, backfill the data, *then* tighten the validator. The `dataTransform` sits between structural operations exactly where the data needs to be in the right shape.

## How authoring works

The query builders (`mongoRaw`, `mongoPipeline`) are the existing tools for building MongoDB queries. They take a contract and produce `MongoQueryPlan` objects — static command descriptions, no database connection required.

The user constructs these builders at the top of the migration file from the scaffolded contract. The `check` and `run` closures use them to describe what the migration should do:

- **`check`** describes a query for "violation" documents — rows that still need the transform. If the result is empty, the transform has already been applied. This gives retry safety: if a migration fails partway through and is re-run, completed transforms are skipped.
- **`run`** describes the actual data modification — an `updateMany`, `insertMany`, `deleteMany`, or aggregation pipeline.

`check` also runs *after* `run` to verify the transform worked. If violations remain, the migration fails with a diagnostic *before* the subsequent `setValidation` would produce a cryptic database error.

`check` also accepts `false` (always run — for idempotent-by-construction cases) or `true` (always skip).

## How serialization works

This is the key constraint: **no TypeScript runs at apply time**. The migration file is evaluated once during `migration verify`, and the resulting command descriptions are written to `ops.json` as JSON. At `migration apply`, only the JSON is loaded and executed.

This works naturally for MongoDB because MongoDB commands *are* JSON. The query builders produce AST objects (`UpdateManyCommand`, `AggregateCommand`, etc.) that are `MongoAstNode` subclasses. These serialize directly via `JSON.stringify` — every node has a `kind` discriminant and public readonly properties. Deserialization reconstructs the class instances from the `kind` field, validated by arktype schemas. This is exactly the same mechanism already used for DDL commands (`CreateIndexCommand`, `CollModCommand`, etc.) in the existing migration serializer.

The lifecycle:

1. **Author**: User writes `migration.ts` with structural ops and data transforms.
2. **Verify**: `migration verify` evaluates the TypeScript, calls `.build()` on the query chain objects to produce `MongoQueryPlan` ASTs, and writes them to `ops.json`.
3. **Apply**: `migration apply` reads `ops.json`, deserializes the command ASTs, and executes them. DDL commands go through `MongoCommandExecutor` (existing path). DML commands go through `MongoAdapter.lower()` → `MongoDriver.execute()` (the existing runtime query execution path).

## Contract in the migration folder

When a migration is scaffolded, `contract.json` and `contract.d.ts` are copied into the migration directory. This gives the query builders their type information and makes the migration self-contained — it doesn't break if the source schema evolves after the migration is written.

For complex migrations that need queries typed against an intermediate schema state (e.g., after adding a nullable field but before tightening to NOT NULL), the user copies their schema authoring surface into the migration folder, modifies it, and runs `contract emit` to produce a second contract:

```
migrations/0003_split-name/
├── migration.ts
├── contract.json            # destination contract (scaffolded)
├── contract.d.ts
├── intermediate.prisma      # intermediate schema (user-authored)
├── intermediate.json        # emitted from intermediate.prisma
└── intermediate.d.ts
```

The user creates a second set of query builders from the intermediate contract and uses them for the data transform that operates against that schema state. Multiple intermediate contracts are supported.

# Decisions

1. **Use existing query builders, not a new abstraction.** `mongoRaw` and `mongoPipeline` already produce `MongoQueryPlan` objects from a contract. The `dataTransform` factory consumes these — no migration-specific query API is needed. A future strongly typed query builder (validating field names and operators against the contract) will slot in transparently because it produces the same `MongoQueryPlan` output.

2. **Module-scoped builders, not injected callbacks.** The Postgres `dataTransform` injects a `Db<Contract>` client into callbacks because the SQL query builder needs a runtime execution context. The Mongo query builders are fully static — they need only a contract. So the user constructs them at module scope and the closures capture them via closure. Simpler, and no resolver infrastructure needed.

3. **Same serialization pattern as DDL.** DML commands (`updateMany`, `aggregate`, etc.) serialize and deserialize using the same `kind`-based rehydration mechanism as DDL commands (`createIndex`, `collMod`, etc.). The existing `mongo-ops-serializer` is extended with DML command kinds. No separate serialization mechanism.

4. **DML execution via `MongoAdapter` + `MongoDriver`.** Data transform commands execute through the existing runtime query path, not through `MongoCommandExecutor` (which handles DDL only). This reuses proven infrastructure.

5. **Contract co-located with the migration.** The contract is scaffolded into the migration directory rather than referenced by path. Makes migrations self-contained and resilient to schema evolution after authoring.

# Requirements

## Functional Requirements

- A `dataTransform(name, { check, run })` factory that produces a data transform migration operation. `check` and `run` are closures returning `Buildable` or `MongoQueryPlan` objects. The resolver calls `.build()` on `Buildable` returns.
- DML command serialization: all `RawMongoCommand` kinds and typed `AggregateCommand` serialize via `JSON.stringify` and deserialize via `kind`-based rehydration with arktype validation, following the existing DDL pattern.
- The migration runner executes data transform operations with the check → (skip or run) → check → (fail or proceed) sequence.
- `check` supports three modes: a closure returning a query (empty result = done), `false` (always run), `true` (always skip).
- A `TODO` sentinel in `dataTransform` prevents attestation.
- Migration scaffolding copies `contract.json` and `contract.d.ts` into the migration directory.

## Non-Functional Requirements

- No TypeScript is executed at apply time.
- DML serialization is consistent with the existing DDL pattern — same module, same dispatch mechanism.
- No changes to existing DDL factories, DDL runner path, or `MongoCommandExecutor`.

## Non-goals

- **Strongly typed Mongo query builder.** `mongoRaw` has untyped filter/update documents; `mongoPipeline` has richer typing for aggregations. A fully typed builder validating field names against the contract is future work and will plug in transparently.
- **Planner integration.** Auto-detecting data migration needs from contract diffs and scaffolding `dataTransform` with TODO placeholders. For v1, data transforms are manually authored.
- **Transaction/session support.** MongoDB multi-document transactions are orthogonal and can be layered on.
- **Graph integration.** Invariant tracking, invariant-aware routing, and ledger recording of data migration names are deferred (same scope as the Postgres graph integration work).

# Acceptance Criteria

## Authoring

- [ ] A migration file with `dataTransform` using `mongoRaw` for `run` and `mongoPipeline` for `check` type-checks and can be verified
- [ ] The resolver calls `.build()` on `Buildable` returns from `check`/`run` closures
- [ ] A `TODO` sentinel in `dataTransform` prevents attestation
- [ ] `check: false` (always run) and `check: true` (always skip) are supported

## Serialization

- [ ] `MongoQueryPlan` command ASTs round-trip through `JSON.stringify` → `kind`-based deserialization
- [ ] All `RawMongoCommand` kinds are handled: `rawUpdateMany`, `rawUpdateOne`, `rawInsertOne`, `rawInsertMany`, `rawDeleteMany`, `rawDeleteOne`, `rawAggregate`, `rawFindOneAndUpdate`, `rawFindOneAndDelete`
- [ ] Typed `aggregate` command (from `mongoPipeline`) is handled
- [ ] Deserialization validates each command shape with arktype schemas

## Execution

- [ ] The runner executes data transform operations: check → (skip or run) → check again → (fail or proceed)
- [ ] DML commands execute via `MongoAdapter.lower()` → `MongoDriver.execute()`
- [ ] On retry, `check` determines whether to skip the data transform's `run`
- [ ] If `check` returns violations after `run`, the migration fails with a diagnostic

## End-to-end

- [ ] A data transform migration round-trips: author → verify → apply against a real MongoDB instance
- [ ] A migration with both DDL operations and a data transform executes correctly in sequence
- [ ] Migration scaffolding produces `contract.json` and `contract.d.ts` in the migration directory

# Other Considerations

## Security

No change from existing model. No TypeScript is executed at apply time. Data migration commands run with the same database permissions as the migration runner.

## Observability

The runner logs data transform start/completion/failure with the migration name.

# Alternatives considered

## Callback injection (Postgres pattern)

The Postgres `dataTransform` injects a typed `Db<Contract>` client into `check`/`run` callbacks. This is necessary for SQL because the query builder needs a runtime execution context (contract + query operation types + adapter) to construct queries. For MongoDB, the query builders are fully static — they need only a contract — so injection adds complexity without benefit.

## Migration-specific query builders (`createMongoBuilders`)

A `createMongoBuilders<Contract>()` helper (analogous to Postgres's `createBuilders<Contract>()`) that returns data-transform-specific builder functions. Rejected because it restricts what operations the user can express and duplicates the existing query builder API surface. Using the general-purpose query builders directly is simpler and more flexible.

## Direct `MongoQueryPlan` construction (no closures)

Since the query builders are static, `check`/`run` could accept `MongoQueryPlan` objects directly instead of closures. Closures are marginally better because they defer `.build()` to the resolver (consistent with the Postgres pattern) and allow the resolver to call `.build()` automatically rather than requiring the user to write it.

# References

- Parent project spec: [`projects/mongo-migration-authoring/spec.md`](../spec.md)
- Cross-target data migrations spec: [`projects/graph-based-migrations/specs/data-migrations-spec.md`](../../graph-based-migrations/specs/data-migrations-spec.md)
- Existing Mongo DDL factories: [`packages/3-mongo-target/1-mongo-target/src/core/migration-factories.ts`](../../../packages/3-mongo-target/1-mongo-target/src/core/migration-factories.ts)
- DDL serializer: [`packages/3-mongo-target/2-mongo-adapter/src/core/mongo-ops-serializer.ts`](../../../packages/3-mongo-target/2-mongo-adapter/src/core/mongo-ops-serializer.ts)
- DML command AST: [`packages/2-mongo-family/4-query/query-ast/src/commands.ts`](../../../packages/2-mongo-family/4-query/query-ast/src/commands.ts)
- Raw command AST: [`packages/2-mongo-family/4-query/query-ast/src/raw-commands.ts`](../../../packages/2-mongo-family/4-query/query-ast/src/raw-commands.ts)
- `mongoRaw`: [`packages/2-mongo-family/5-query-builders/orm/src/mongo-raw.ts`](../../../packages/2-mongo-family/5-query-builders/orm/src/mongo-raw.ts)
- `mongoPipeline`: [`packages/2-mongo-family/5-query-builders/pipeline-builder/src/pipeline.ts`](../../../packages/2-mongo-family/5-query-builders/pipeline-builder/src/pipeline.ts)
- Postgres data transform: [`packages/3-targets/3-targets/postgres/src/core/migrations/operation-descriptors.ts`](../../../packages/3-targets/3-targets/postgres/src/core/migrations/operation-descriptors.ts)
- ADR 188 — MongoDB migration operation model
- ADR 191 — Generic three-phase migration operation envelope

# Open Questions

1. **Operation type shape in ops.json.** Data transform operations don't fit the existing `MongoMigrationPlanOperation` shape (which has `precheck`/`execute`/`postcheck` containing DDL commands). **Default assumption:** use `operationClass: 'data'` as discriminant, with `check`/`run` fields instead of `precheck`/`execute`/`postcheck`.

2. **Where does `dataTransform` live?** **Default assumption:** in `@prisma-next/target-mongo/migration` alongside the DDL factories, since it produces an operation consumed by the same runner and serialized to the same `ops.json`.

3. **Aggregation pipeline stage deserialization scope.** The typed `MongoPipelineStage` classes have ~25 `kind` values. **Default assumption:** implement the subset needed for `check` queries (`$match`, `$limit`, `$sort`, `$project`) and common transform patterns (`$addFields`, `$lookup`, `$merge`); extend as needed.
