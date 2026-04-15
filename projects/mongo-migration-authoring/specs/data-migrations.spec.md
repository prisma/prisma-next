# Summary

Users can author data transformations in MongoDB migrations using the existing query builders (`mongoRaw`, `mongoPipeline`). A `dataTransform` operation slots into the migration operation chain alongside structural DDL factories. Query builders produce `MongoQueryPlan` AST objects from a contract — no database connection needed at authoring time. The plans serialize to JSON in `ops.json` using the same `kind`-based pattern as DDL commands, and the runner executes them via the existing `MongoAdapter` → `MongoDriver` pipeline.

# Description

## Context

Manual Mongo migration authoring is implemented: factory functions (`createIndex`, `dropIndex`, `createCollection`, `dropCollection`, `setValidation`) produce `MongoMigrationPlanOperation` objects containing DDL commands. The `Migration` base class makes files self-executing. The runner consumes `ops.json` and executes DDL via `MongoCommandExecutor`.

Data migrations for Postgres are also implemented: `dataTransform` accepts typed callbacks that produce SQL query plans, which are lowered to `{ sql, params }` at verify time and stored in `ops.json`. No TypeScript runs at apply time.

MongoDB needs the same capability: data transformations expressed as migration operations, serialized as JSON, executed at apply time without loading user code.

## How it works

The key insight is that MongoDB commands are natively JSON. Unlike SQL (where an AST must be lowered to text), MongoDB command ASTs serialize directly via `JSON.stringify` and deserialize via `kind`-based rehydration — the same mechanism already used for DDL commands. The existing query builders (`mongoRaw`, `mongoPipeline`) produce `MongoQueryPlan` objects statically from a contract, with no runtime or database connection required.

### Migration file

```typescript
// migrations/0002_backfill-status/migration.ts
import type { Contract } from './contract.d'
import contractJson from './contract.json' with { type: 'json' }
import { createCollection, setValidation, dataTransform } from '@prisma-next/target-mongo/migration'
import { mongoRaw } from '@prisma-next/mongo-orm'
import { mongoPipeline } from '@prisma-next/mongo-pipeline-builder'

const raw = mongoRaw({ contract: contractJson as Contract })
const agg = mongoPipeline<Contract>({ contractJson })

export default class extends Migration {
  plan() {
    return [
      createCollection("users", { ... }),
      dataTransform("backfill-status", {
        check: () => agg.from('users')
          .match({ status: { $exists: false } })
          .limit(1),
        run: () => raw.collection('users')
          .updateMany({ status: { $exists: false } }, { $set: { status: "active" } }),
      }),
      setValidation("users", { ... }),
    ]
  }
}

Migration.run(import.meta.url, exports.default)
```

The query builders are constructed at module scope from the contract. The `check` and `run` closures use them to produce `Buildable` objects (query chains before `.build()`). The resolver calls `.build()` to capture `MongoQueryPlan` ASTs.

### Contract in the migration folder

When a migration is scaffolded, `contract.json` and `contract.d.ts` are dumped into the migration directory. This gives the query builders their type information without depending on a path outside the migration folder.

### Intermediate contracts

Complex migrations need queries typed against an intermediate schema state (e.g., after adding nullable columns but before tightening to NOT NULL). The user copies their authoring surface (e.g., `schema.prisma`) into the migration folder, modifies it to reflect the intermediate state, and runs `contract emit` to produce a second `contract.json` + `contract.d.ts`:

```
migrations/0003_split-name/
├── migration.ts
├── contract.json            # destination contract (scaffolded)
├── contract.d.ts
├── intermediate.prisma      # intermediate schema (user-authored)
├── intermediate.json        # emitted from intermediate.prisma
└── intermediate.d.ts
```

```typescript
import type { Contract } from './contract.d'
import type { IntermediateContract } from './intermediate.d'
import contractJson from './contract.json' with { type: 'json' }
import intermediateJson from './intermediate.json' with { type: 'json' }

const finalRaw = mongoRaw({ contract: contractJson as Contract })
const intermediateRaw = mongoRaw({ contract: intermediateJson as IntermediateContract })
```

Multiple intermediate contracts are supported — one per data transform if needed.

### Serialization lifecycle

1. **Scaffold (Draft)**: `migration plan` or `migration new` produces the migration directory with `contract.json`, `contract.d.ts`, and `migration.ts`. If a data transform is needed, `migration.ts` includes a `dataTransform` with TODO placeholders.
2. **Author (Draft)**: User fills in `check`/`run` using the query builders. Still draft.
3. **Verify/Attest**: `migration verify` evaluates the TypeScript, calls `.build()` on the `Buildable` objects returned by `check`/`run`, serializes the resulting `MongoQueryPlan` ASTs to `ops.json`. The package is now attested.
4. **Apply**: `migration apply` reads `ops.json`, deserializes the command ASTs via `kind`-based rehydration, and executes them via `MongoAdapter.lower()` → `MongoDriver.execute()`. No TypeScript is loaded.

### Representation in ops.json

A data transform operation in `ops.json` follows the same three-phase envelope as DDL operations, with the `check` and `run` fields carrying serialized `MongoQueryPlan` command ASTs:

```json
{
  "id": "data_migration.backfill-status",
  "label": "Data transform: backfill-status",
  "operationClass": "data",
  "check": {
    "collection": "users",
    "command": {
      "kind": "aggregate",
      "collection": "users",
      "pipeline": [
        { "kind": "match", "filter": { "kind": "field", "field": "status", "op": "$exists", "value": false } },
        { "kind": "limit", "count": 1 }
      ]
    },
    "meta": { "target": "mongo", "storageHash": "...", "lane": "mongo-pipeline", "paramDescriptors": [] }
  },
  "run": [{
    "collection": "users",
    "command": {
      "kind": "rawUpdateMany",
      "collection": "users",
      "filter": { "status": { "$exists": false } },
      "update": { "$set": { "status": "active" } }
    },
    "meta": { "target": "mongo", "storageHash": "...", "lane": "mongo-raw", "paramDescriptors": [] }
  }]
}
```

The command `kind` discriminant (`"aggregate"`, `"rawUpdateMany"`, `"rawInsertOne"`, etc.) drives deserialization — the same pattern used for DDL commands (`"createIndex"`, `"dropCollection"`, etc.).

### Runner execution model

The runner processes data transform operations with the check → run → check sequence:

1. **Check**: deserialize and execute the `check` query. Empty result = already applied (skip `run`). Non-empty = needs to run. `check: false` means always run; `check: true` means always skip.
2. **Run**: deserialize and execute each `run` command sequentially.
3. **Check again**: re-execute the `check` query. If violations remain, the migration fails before subsequent tightening operations.

DML commands are executed via the same `MongoAdapter.lower()` → `MongoDriver.execute()` path used for runtime queries, not via `MongoCommandExecutor` (which handles DDL only).

### Query builder typing

`mongoRaw` provides type-safe collection name access (constrained to `keyof TContract['roots']`) but untyped filter/update documents (`Document` = `Record<string, unknown>`). `mongoPipeline` provides richer typing via field proxies and filter proxies.

A strongly typed query builder that validates field names and update operators against the contract can be added later. It will slot in transparently — same contract input, same `MongoQueryPlan` output. The migration infrastructure does not change.

# Requirements

## Functional Requirements

- A `dataTransform(name, { check, run })` factory function that produces a data transform operation for MongoDB migrations. `check` and `run` are closures returning `Buildable` (or `MongoQueryPlan`) objects.
- The resolver calls `.build()` on `Buildable` returns and serializes the `MongoQueryPlan` ASTs to `ops.json`.
- DML command serialization: `MongoQueryPlan` command ASTs (all `RawMongoCommand` and `AnyMongoCommand` kinds) serialize via `JSON.stringify` and deserialize via `kind`-based rehydration with arktype validation, following the existing DDL command serialization pattern in `mongo-ops-serializer.ts`.
- The migration runner executes data transform operations: deserializes `MongoQueryPlan` from ops.json, lowers via `MongoAdapter`, executes via `MongoDriver`.
- The check → run → check execution sequence matches the Postgres data migration pattern.
- `check` supports three modes: a closure returning a `Buildable`/`MongoQueryPlan` (the common case — empty result = done), `false` (always run), `true` (always skip).
- Migration scaffolding dumps `contract.json` and `contract.d.ts` into the migration directory.
- Users can create intermediate contracts for complex migrations by emitting from a modified schema in the migration directory.
- A `TODO` sentinel in `dataTransform` prevents attestation (same as Postgres).

## Non-Functional Requirements

- No TypeScript is executed at apply time. Only serialized command ASTs from `ops.json` are loaded and executed.
- DML command serialization/deserialization is consistent with the existing DDL pattern — same `kind`-based dispatch, same arktype validation schemas, same module (`mongo-ops-serializer.ts` or equivalent).
- No changes to the existing DDL factory functions, the DDL runner path, or the `MongoCommandExecutor`.

## Non-goals

- A strongly typed Mongo query builder that validates field names and operators against the contract. The existing `mongoRaw` (untyped documents) and `mongoPipeline` (typed aggregation) are sufficient for v1. A typed builder can be added later and will work transparently.
- Auto-detection of data migration needs from contract diffs (planner integration). For v1, data transforms are manually authored via `migration new`.
- Scaffolding `dataTransform` with TODO placeholders from the planner. This requires planner integration and is future work.
- Transaction/session support for data transforms. MongoDB multi-document transactions are orthogonal and can be layered on later.
- Graph integration (invariant tracking, invariant-aware routing, ledger recording of data migration names). This is the same scope as the Postgres graph integration work and is deferred.
- Aggregation pipeline mutations via `$merge`/`$out` as a first-class pattern. Users can express these via `mongoPipeline` already; no special infrastructure needed.

# Acceptance Criteria

## Authoring

- [ ] A migration file with `dataTransform` using `mongoRaw` for `run` and `mongoPipeline` for `check` type-checks and can be verified
- [ ] `check` and `run` closures receive no injected parameters — they use module-scoped query builders
- [ ] The resolver calls `.build()` on `Buildable` returns from `check`/`run`
- [ ] A `TODO` sentinel in `dataTransform` prevents attestation
- [ ] `check: false` (always run) and `check: true` (always skip) are supported

## Serialization

- [ ] `MongoQueryPlan` command ASTs round-trip through `JSON.stringify` → deserialize via `kind`-based rehydration
- [ ] All `RawMongoCommand` kinds are handled: `rawUpdateMany`, `rawUpdateOne`, `rawInsertOne`, `rawInsertMany`, `rawDeleteMany`, `rawDeleteOne`, `rawAggregate`, `rawFindOneAndUpdate`, `rawFindOneAndDelete`
- [ ] Typed command kinds are handled: `aggregate` (from `mongoPipeline`)
- [ ] Deserialization validates each command shape with arktype schemas
- [ ] Data transform operations appear in `ops.json` with serialized `check` and `run` fields

## Execution

- [ ] The runner executes data transform operations: check → (skip or run) → check again → (fail or proceed)
- [ ] DML commands are executed via `MongoAdapter.lower()` → `MongoDriver.execute()`
- [ ] On retry, `check` determines whether to skip the data transform's `run`
- [ ] If `check` returns violations after `run`, the migration fails with a diagnostic

## Scaffolding

- [ ] Migration scaffolding produces `contract.json` and `contract.d.ts` in the migration directory
- [ ] Users can create intermediate contracts in the migration directory for complex migrations

## End-to-end

- [ ] A data transform migration round-trips: author → verify (serialize) → apply (deserialize + execute) against a real MongoDB instance
- [ ] A migration with both DDL operations and a data transform executes correctly in sequence
- [ ] A migration with an intermediate contract for mid-chain typed queries works end-to-end

# Other Considerations

## Security

No change from existing model. No TypeScript is executed at apply time — only serialized command ASTs from `ops.json`. Data migration commands run with the same database permissions as the migration runner.

## Observability

The runner logs data transform start/completion/failure with the migration name, matching the Postgres runner behavior.

# References

- Parent project spec: [`projects/mongo-migration-authoring/spec.md`](../spec.md)
- Cross-target data migrations spec: [`projects/graph-based-migrations/specs/data-migrations-spec.md`](../../graph-based-migrations/specs/data-migrations-spec.md)
- Existing Mongo DDL factories: [`packages/3-mongo-target/1-mongo-target/src/core/migration-factories.ts`](../../../packages/3-mongo-target/1-mongo-target/src/core/migration-factories.ts)
- Existing DDL serializer: [`packages/3-mongo-target/2-mongo-adapter/src/core/mongo-ops-serializer.ts`](../../../packages/3-mongo-target/2-mongo-adapter/src/core/mongo-ops-serializer.ts)
- DML command AST: [`packages/2-mongo-family/4-query/query-ast/src/commands.ts`](../../../packages/2-mongo-family/4-query/query-ast/src/commands.ts)
- Raw command AST: [`packages/2-mongo-family/4-query/query-ast/src/raw-commands.ts`](../../../packages/2-mongo-family/4-query/query-ast/src/raw-commands.ts)
- `mongoRaw` client: [`packages/2-mongo-family/5-query-builders/orm/src/mongo-raw.ts`](../../../packages/2-mongo-family/5-query-builders/orm/src/mongo-raw.ts)
- `mongoPipeline` builder: [`packages/2-mongo-family/5-query-builders/pipeline-builder/src/pipeline.ts`](../../../packages/2-mongo-family/5-query-builders/pipeline-builder/src/pipeline.ts)
- Postgres data transform implementation: [`packages/3-targets/3-targets/postgres/src/core/migrations/operation-descriptors.ts`](../../../packages/3-targets/3-targets/postgres/src/core/migrations/operation-descriptors.ts)
- Mongo runner: [`packages/3-mongo-target/2-mongo-adapter/src/core/mongo-runner.ts`](../../../packages/3-mongo-target/2-mongo-adapter/src/core/mongo-runner.ts)
- Mongo adapter (DML lowering): [`packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts`](../../../packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts)
- ADR 188 — MongoDB migration operation model
- ADR 191 — Generic three-phase migration operation envelope
- ADR 176 — Data migrations as invariant-guarded transitions

# Decisions

1. **No callback injection.** Unlike Postgres `dataTransform` where the resolver creates a `Db<Contract>` and passes it to callbacks, Mongo data transforms use module-scoped query builders constructed from the scaffolded contract. The closures capture these builders via closure scope. This is simpler because the Mongo query builders are fully static — they need only a contract, not a runtime context.

2. **Same serialization pattern as DDL.** DML commands serialize/deserialize using the same `kind`-based rehydration as DDL commands. No separate serialization mechanism. The `mongo-ops-serializer` is extended (or a parallel module added) to handle DML command kinds.

3. **`MongoAdapter` + `MongoDriver` for DML execution.** Data transform commands are executed through the existing runtime execution path (`MongoAdapter.lower()` → `MongoDriver.execute()`), not through `MongoCommandExecutor` (which handles DDL only). This reuses proven infrastructure without extending the DDL executor.

4. **Contract scaffolded into migration directory.** The contract is co-located with the migration rather than referenced by path. This makes migrations self-contained and avoids breakage when the source schema evolves.

# Open Questions

1. **Operation type in ops.json**: Data transform operations don't fit the existing `MongoMigrationPlanOperation` shape (which has `precheck`/`execute`/`postcheck` containing DDL commands). Options: (a) extend the union to include a data transform variant with `check`/`run` fields, (b) use a separate operation discriminant (like Postgres's `operationClass: 'data'`), (c) use a new top-level type. **Default assumption:** Option (b) — use `operationClass: 'data'` as the discriminant, with `check` and `run` fields instead of `precheck`/`execute`/`postcheck`.

2. **Where does `dataTransform` live?** The DDL factories are in `@prisma-next/target-mongo/migration`. `dataTransform` could go there too, or in `@prisma-next/family-mongo/migration` alongside `MongoMigration`. **Default assumption:** In `@prisma-next/target-mongo/migration` alongside the DDL factories, since it produces an operation that goes into the same `ops.json` and is consumed by the same runner.

3. **Aggregation pipeline stage serialization**: The typed `MongoPipelineStage` classes (from `mongoPipeline`) are `MongoAstNode` subclasses that serialize via `JSON.stringify`. Deserialization needs to reconstruct the stage class instances from `kind` discriminants. There are ~25 stage kinds. Is it worth implementing full rehydration for all of them for v1, or should we start with the most common subset (`$match`, `$limit`, `$sort`, `$project`, `$addFields`, `$lookup`, `$merge`)? **Default assumption:** Start with a subset that covers the check query pattern (match + limit) and the most common data transform patterns, and extend as needed.
