# Mongo Data Migrations — Plan

## Summary

Add data transform support to MongoDB migrations. Users author transforms using the existing `mongoRaw` and `mongoQuery` query builders, which produce `MongoQueryPlan` ASTs from a scaffolded contract. The plans serialize to `ops.json` as JSON (same pattern as DDL commands) and execute at apply time via `MongoAdapter` → `MongoDriver`. No TypeScript runs at apply time.

**Spec:** `projects/mongo-migration-authoring/specs/data-migrations.spec.md`

## Collaborators


| Role     | Person/Team | Context                                                      |
| -------- | ----------- | ------------------------------------------------------------ |
| Maker    | TBD         | Drives execution                                             |
| Reviewer | TBD         | Architectural review — serialization model, runner extension |


## Milestones

### Milestone 1: DML command serialization

Extend the serialization layer to handle DML commands (`RawMongoCommand` kinds and typed `AggregateCommand`). After this milestone, a `MongoQueryPlan` containing any supported command kind round-trips through `JSON.stringify` → deserialize → rehydrated AST.

**Tasks:**

- Define arktype schemas for each `RawMongoCommand` kind: `rawUpdateMany`, `rawUpdateOne`, `rawInsertOne`, `rawInsertMany`, `rawDeleteMany`, `rawDeleteOne`, `rawAggregate`, `rawFindOneAndUpdate`, `rawFindOneAndDelete`
- Define arktype schema for typed `AggregateCommand` (and the pipeline stage subset needed for `check` queries: `$match`, `$limit`, `$sort`, `$project`)
- Implement `deserializeDmlCommand(json)` — switch on `kind`, validate with arktype, reconstruct the command class instance
- Implement `deserializeMongoQueryPlan(json)` — deserializes the full `MongoQueryPlan` envelope (collection, command, meta)
- Tests: round-trip every supported command kind through serialize → deserialize; verify rehydrated AST matches original
- Tests: error cases — unknown `kind`, missing required fields, invalid field types

### Milestone 2: `dataTransform` factory and operation type

Implement the `dataTransform` factory function and define the data transform operation shape in `ops.json`. After this milestone, a migration file can include `dataTransform(...)` calls that produce serializable operations.

**Tasks:**

- Define the data transform operation type — extends `MigrationPlanOperation` with `operationClass: 'data'`, `check` (serialized `MongoQueryPlan` | boolean), `run` (serialized `MongoQueryPlan[]`)
- Implement `dataTransform(name, { check, run })` factory function in `@prisma-next/target-mongo/migration`. Accepts closures returning `Buildable` or `MongoQueryPlan`. Calls `.build()` on `Buildable` returns.
- Implement `TODO` sentinel support — a `dataTransform` with `TODO` placeholders prevents attestation
- Support `check: false` (always run) and `check: true` (always skip)
- Export `dataTransform` from `@prisma-next/target-mongo/migration`
- Tests: `dataTransform` produces correct operation shape
- Tests: `.build()` is called on `Buildable` returns
- Tests: `TODO` sentinel prevents attestation
- Tests: `check: false` and `check: true` produce correct serialized output
- Tests: data transform operations serialize to JSON and deserialize correctly

### Milestone 3: Runner DML execution

Extend the migration runner to execute data transform operations via the `MongoAdapter` → `MongoDriver` path. After this milestone, `migration apply` can execute a migration containing data transforms against a real MongoDB instance.

**Tasks:**

- Extend the runner's operation dispatch to recognize `operationClass: 'data'` operations
- Implement the check → (skip or run) → check again → (fail or proceed) execution sequence
- Wire DML execution through `MongoAdapter.lower()` → `MongoDriver.execute()` (distinct from the DDL `MongoCommandExecutor` path)
- Handle `check: false` (always run) and `check: true` (always skip) in the runner
- Add logging for data transform start/completion/failure with the migration name
- Tests: runner executes data transform operations in sequence with DDL operations
- Tests: check → skip when check returns empty result (already applied)
- Tests: check → run → check again → fail when violations remain
- Tests: retry safety — re-running a completed data transform skips via check

### Milestone 4: Contract scaffolding and end-to-end

Wire contract scaffolding into the migration directory and validate the full pipeline end-to-end against a real MongoDB instance.

**Tasks:**

- Extend migration scaffolding to dump `contract.json` and `contract.d.ts` into the migration directory
- E2E test: author a migration with DDL + `dataTransform`, verify (serialize), apply (deserialize + execute) against MongoDB
- E2E test: migration with an intermediate contract — two query builder contexts in the same file
- E2E test: retry safety — apply a migration that was partially applied, verify check skips completed transforms
- E2E test: check failure — data transform whose `run` doesn't fix all violations, verify runner fails with diagnostic
- Verify all acceptance criteria from the spec are met

**Close-out:**

- Verify all acceptance criteria from the spec are met
- Update project documentation if needed



## Acceptance 

- Every AC must be demonstrated in an E2E or integration test
- All mongo demo apps must be updated to show a data migration
- E2E or demo apps must demonstrate applying a migration which was output from a migration.ts file, including a data transform operation

## Test Coverage


| Acceptance Criterion                                           | Test Type   | Milestone | Notes                                    |
| -------------------------------------------------------------- | ----------- | --------- | ---------------------------------------- |
| Migration file with `dataTransform` type-checks and verifies   | Unit        | M2        | Factory produces correct operation shape |
| Closures use module-scoped query builders (no injected params) | Unit        | M2        | Verified by API — no `db` parameter      |
| Resolver calls `.build()` on `Buildable` returns               | Unit        | M2        |                                          |
| `TODO` sentinel prevents attestation                           | Unit        | M2        |                                          |
| `check: false` and `check: true` supported                     | Unit        | M2        |                                          |
| `MongoQueryPlan` round-trips through serialize → deserialize   | Unit        | M1        | All command kinds                        |
| All `RawMongoCommand` kinds handled                            | Unit        | M1        | 9 command kinds                          |
| Typed `aggregate` command handled                              | Unit        | M1        | Pipeline stage subset                    |
| Deserialization validates with arktype                         | Unit        | M1        |                                          |
| Data transform ops appear in `ops.json`                        | Unit        | M2        | Serialization of data transform envelope |
| Runner: check → skip or run → check → fail or proceed          | Unit        | M3        |                                          |
| DML via `MongoAdapter.lower()` → `MongoDriver.execute()`       | Integration | M3        |                                          |
| Retry: check determines whether to skip                        | Unit        | M3        |                                          |
| Check violations after run → migration fails                   | Unit        | M3        |                                          |
| Contract scaffolded into migration directory                   | Integration | M4        |                                          |
| Intermediate contracts for complex migrations                  | E2E         | M4        |                                          |
| Full round-trip: author → verify → apply                       | E2E         | M4        | Against real MongoDB                     |
| Mixed DDL + data transform in sequence                         | E2E         | M4        |                                          |
| Intermediate contract with mid-chain queries                   | E2E         | M4        |                                          |


## Open Items

1. **Operation type shape in ops.json**: The spec proposes `operationClass: 'data'` as discriminant with `check`/`run` fields instead of `precheck`/`execute`/`postcheck`. This needs to be validated against the framework's `MigrationPlanOperation` base type — it may need to be extended or the data transform may need its own type. Resolve during M2.
2. **Aggregation pipeline stage deserialization scope**: The pipeline builder produces ~25 stage kinds. For v1, implementing deserialization for the subset needed by `check` queries (`$match`, `$limit`, `$sort`, `$project`) plus common data transform patterns (`$addFields`, `$merge`, `$lookup`) is likely sufficient. Extend as users hit gaps.
3. **Where the serializer lives**: The existing DDL serializer is in `mongo-ops-serializer.ts` in the adapter package. If the migration-subsystem-refactor spec is implemented first (moving the serializer to `target-mongo`), the DML serializer goes there too. Otherwise, it goes in the adapter alongside the existing serializer for now and moves later.
4. **Runner architecture**: The runner currently only handles DDL via `MongoCommandExecutor` (visitor pattern). Data transforms need a different execution path (`MongoAdapter` + `MongoDriver`). The runner needs access to both. If the migration-subsystem-refactor spec is done first (runner accepts injected executors), the adapter/driver can be injected alongside the DDL executors. Otherwise, the runner needs to be extended to accept the adapter/driver as additional dependencies.
5. **Filter expression serialization for typed commands**: The `mongoQuery` builder produces typed `MongoPipelineStage` and `MongoFilterExpr` objects. The existing `mongo-ops-serializer` already handles `MongoFilterExpr` deserialization (for DDL prechecks/postchecks). Pipeline stages need new deserialization logic, but the pattern is identical.
