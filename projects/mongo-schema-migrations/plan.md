# Schema Migrations for MongoDB

## Summary

Extend the migration system to manage MongoDB's server-side configuration (indexes, JSON Schema validators, collection options) through the same graph-based migration model used for SQL DDL. The project proves the migration architecture generalizes beyond SQL by implementing a Mongo planner, runner, schema IR, and target wiring — all against the existing family-agnostic migration SPI.

**Spec:** `projects/mongo-schema-migrations/spec.md`
| Milestone | Linear |
|---|---|
| M1: Family migration SPI + vertical slice | [TML-2220](https://linear.app/prisma-company/issue/TML-2220) |
| M2: Full index vocabulary + validators + collection options | [TML-2231](https://linear.app/prisma-company/issue/TML-2231) |
| M3: Polymorphic index generation | [TML-2232](https://linear.app/prisma-company/issue/TML-2232) |
| M4: Online CLI commands + live introspection | [TML-2233](https://linear.app/prisma-company/issue/TML-2233) |

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will | Drives execution |
| Reviewer | Saevar | Migration system owner (WS1); CLI generalization coordination |
| Collaborator | ORM consolidation (Will) | Polymorphic contract shape (M3 dependency) |

## Testing principle

**Every milestone and every major component must demonstrate its functionality against a real MongoDB instance** (via `mongodb-memory-server`). Unit tests validate internal logic (AST construction, planner diffing, filter evaluation); integration tests prove the output actually works against a database. Each milestone ends with an end-to-end proof task that exercises the full pipeline: contract → plan → apply → verify on a live MongoDB instance.

## Milestones

### Milestone 1: Family migration SPI + vertical slice (single index, end-to-end)

Proves the full migration architecture works for MongoDB by cutting a thin vertical slice through every layer: contract → schema IR → planner → runner → CLI. The simplest case: one ascending index on one collection. Validates with a hand-crafted contract (no authoring/emitter changes needed).

**Tasks:**

**SPI + CLI generalization:**

- [x] **1.1 Validate migration SPI for Mongo.** Confirm the existing `TargetMigrationsCapability` / `MigrationPlanner` / `MigrationRunner` interfaces work for the Mongo target without structural changes. This is an architectural validation exercise: if the existing SPI works, document the finding and move on. If something blocks, make the minimal change needed and document it. Do not refactor proactively.
  - **Finding (validated):** The SPI uses `unknown` for `contract`, `schema`, and return types in `MigrationPlanner`/`MigrationRunner`. `contractToSchema` accepts `Contract | null` and returns `unknown`. No SQL-specific constraints exist. `MongoMigrationPlanner` can implement `MigrationPlanner<'mongo','mongo'>` and internally cast `contract` to `MongoContract`, `schema` to `MongoSchemaIR`. No framework changes needed.
- [x] **1.2 Generalize CLI operation display.** Introduce a family-aware `extractOperationStatements(familyId, operations)` dispatch function in the CLI. SQL continues to use `extractSqlDdl`. Mongo uses a `MongoDdlCommandFormatter` (a `MongoDdlCommandVisitor<string>`) to produce human-readable display strings from DDL command AST nodes. See [CLI display design](specs/cli-display.spec.md) and [DDL command dispatch design](specs/ddl-command-dispatch.spec.md).

**Contract types:**

- [x] **1.3 Extend `MongoStorageCollection` with index definitions.** Change `MongoStorageCollection` from `Record<string, never>` to carry `indexes?: ReadonlyArray<MongoStorageIndex>`. For M1, `MongoStorageIndex` supports: ordered fields with key types (`1`, `-1`), `unique` option. Write unit tests for the type shape.
- [x] **1.4 Update `MongoContractSchema` (Arktype validation).** The Arktype schema currently rejects extra keys on collection entries. Update to accept and validate index definitions. Write validation tests (valid/invalid index shapes).

**Schema IR:**

- [x] **1.5 Define `MongoSchemaIR` AST.** Following the class-based AST pattern from the SQL query AST, Mongo pipeline AST, and Mongo expression AST: base class with abstract `kind` discriminant + `freeze()` for immutability; intermediate abstract `MongoSchemaNode` with `accept(visitor)` for double dispatch; concrete frozen classes `MongoSchemaCollection` and `MongoSchemaIndex` with `readonly kind = '...' as const`; union type `AnyMongoSchemaNode`; visitor interface `MongoSchemaVisitor<R>` with one method per node type. Package placement: new package in `packages/2-mongo-family/` (tooling layer, migration plane). Write unit tests for AST construction, freeze behavior, and visitor dispatch.
- [x] **1.6 Implement `contractToSchema` for Mongo.** Synthesize a `MongoSchemaIR` from a `MongoContract`. When contract is `null` (new project), return empty IR. Lives in `packages/3-mongo-target/`. Write tests with hand-crafted contracts.

**DDL command AST + operation types:**

- [x] **1.7a Add DDL commands and inspection commands to `@prisma-next/mongo-query-ast`.** Create DDL command AST classes extending `MongoAstNode`: `CreateIndexCommand`, `DropIndexCommand`. Create inspection command AST classes: `ListIndexesCommand`, `ListCollectionsCommand`. Add union types: `AnyMongoDdlCommand`, `AnyMongoInspectionCommand`. Split the package entrypoints into `/execution` (existing DML commands, `MongoQueryPlan`) and `/control` (DDL commands, inspection commands, migration check/step/operation types). Write unit tests for AST construction and freeze behavior.
- [x] **1.7b Define `MongoMigrationPlanOperation` as symmetric data envelope.** Define `MongoMigrationCheck` (source inspection command + `MongoFilterExpr` + expect), `MongoMigrationStep` (description + DDL command), and `MongoMigrationPlanOperation` (extends `MigrationPlanOperation` with `precheck[]`, `execute[]`, `postcheck[]`). No class hierarchy, no visitor — operations are plain data. Write unit tests for construction and JSON serialization round-trip.
- [x] **1.7c Implement client-side `FilterEvaluator`.** Implement `MongoFilterVisitor<boolean>` that evaluates `MongoFilterExpr` against in-memory JavaScript objects. Support `$eq` (with deep structural equality), `$ne`, `$gt`, `$lt`, `$gte`, `$lte`, `$in`, `$and`, `$or`, `$not`, `$exists`. Support dotted field paths. See [check-evaluator.spec.md](specs/check-evaluator.spec.md). Write thorough unit tests: operator semantics, logical combinators, deep equality, nested field access, edge cases.

**Planner:**

- [ ] **1.8 Implement `MongoMigrationPlanner`.** Diff destination contract against origin `MongoSchemaIR`. For M1: detect added indexes → `planCreateIndex` (additive), removed indexes → `planDropIndex` (destructive). Index identity by (collection + ordered fields + key types + semantic options), not by name. Planner convenience functions compose DDL commands, inspection commands, and filter-expression checks into `MongoMigrationPlanOperation` structures. Returns `MigrationPlannerResult`. Unit tests covering: add index, drop index, no-op (same indexes), index identity (same keys different name = equivalent), correct precheck/execute/postcheck arrays. Integration test: feed planner output to the runner against `mongodb-memory-server` and verify the resulting database state.

**Runner + wiring:**

- [ ] **1.9 Implement `MongoMigrationRunner`.** Generic three-phase loop mirroring the SQL runner: for each operation, evaluate prechecks (filter expressions against inspection results) → execute DDL commands (via command executor switch) → evaluate postchecks. Idempotency probe: if all postchecks already satisfied before execution, skip. Command executor maps each `AnyMongoDdlCommand.kind` to the corresponding MongoDB driver call. Uses `mongodb-memory-server` for integration tests.
- [ ] **1.10 Implement marker and ledger in `_prisma_migrations`.** Marker document: `{ _id: "marker", coreHash, profileHash, updatedAt, ... }`. Ledger: append-only documents (one per applied edge). Compare-and-swap on marker via `findOneAndUpdate({ _id: "marker", coreHash: expectedFrom })`. Implement `readMarker()` on the Mongo control family instance. Integration tests with `mongodb-memory-server`.
- [ ] **1.11 Wire Mongo target descriptor.** Add `migrations: { createPlanner, createRunner, contractToSchema }` to `@prisma-next/adapter-mongo`, implementing `TargetMigrationsCapability<'mongo', 'mongo'>`. Verify the CLI discovers and uses the capability.

**End-to-end proof:**

- [ ] **1.12 End-to-end test: plan + apply single index.** Hand-crafted contract with one ascending index on one collection. Verify: `migration plan` produces a `createIndex` operation → `migration apply` creates the index on a real MongoDB instance (via `mongodb-memory-server`). Second contract removing the index → plan produces `dropIndex` → apply drops it.

### Milestone 2: Full index vocabulary + validators + collection options

Extends every layer to cover the full breadth of MongoDB server-side configuration. Still validates with hand-crafted contracts for indexes/validators/options, plus adds authoring + emitter support.

**Tasks:**

**Full index vocabulary:**

- [ ] **2.1 Extend index key types.** Support compound indexes, descending (`-1`), text (`"text"`), geospatial (`"2dsphere"`), wildcard (`"$**"`). Update `MongoStorageIndex` type, schema IR, Arktype validation, planner diffing, and runner execution. Tests for each key type.
- [ ] **2.2 Extend index options.** Support `sparse`, `expireAfterSeconds` (TTL), `partialFilterExpression` (partial indexes). Update types, IR, validation, planner, runner. Tests for each option. Include index identity tests: same keys + different options = different index.

**Validators:**

- [ ] **2.3 Extend `MongoStorageCollection` with validator.** Add `validator?: { jsonSchema: Record<string, unknown>; validationLevel: 'strict' | 'moderate'; validationAction: 'error' | 'warn' }` to the contract type. Update Arktype schema. Type and validation tests.
- [ ] **2.4 Extend schema IR and planner for validators.** Add validator representation to `MongoSchemaIR`. Add `CollModCommand` DDL command class. Planner generates `collMod` operations with appropriate `MongoFilterExpr`-based postchecks against `listCollections` results. Classify: relaxing validation = `widening`, tightening = `destructive`. Unit tests for add/remove/change validator. Integration test: planner output → runner → verify validator applied on `mongodb-memory-server`.
- [ ] **2.5 Runner executes validator operations.** Command executor handles `CollModCommand` with `$jsonSchema`, `validationLevel`, `validationAction`. Integration tests.

**Collection options:**

- [ ] **2.6 Extend `MongoStorageCollection` with collection options.** Capped settings, time series configuration, collation, change stream pre/post images. Update Arktype schema. Tests.
- [ ] **2.7 Extend schema IR and planner for collection options.** Add `CreateCollectionCommand` and `DropCollectionCommand` DDL command classes. Planner generates operations with `listCollections`-based checks for new collections and option changes. Unit tests. Integration test: planner output → runner → verify collection options on `mongodb-memory-server`.
- [ ] **2.8 Runner executes collection option operations.** Command executor handles `CreateCollectionCommand` (with options), `DropCollectionCommand`, and `CollModCommand` for option changes. Integration tests.

**Authoring + emitter:**

- [ ] **2.9 Add PSL authoring support for Mongo indexes.** Support `@@index` and `@@unique` annotations in the Mongo PSL interpreter. Update `@prisma-next/mongo-contract-psl` to populate `storage.collections[].indexes` from annotations. Tests with PSL fixtures.
- [ ] **2.10 Update Mongo emitter to populate enriched `storage.collections`.** Emit index definitions, validator (auto-derived `$jsonSchema` from model field definitions), and collection options into the contract. Tests verifying emitted contracts match expected shapes.

**End-to-end proof:**

- [ ] **2.11 End-to-end test: full vocabulary against real MongoDB.** Hand-crafted contracts exercising compound indexes, TTL indexes, partial indexes, validators (`$jsonSchema` + `validationLevel`), and collection options (capped, collation). Verify: `migration plan` produces correct operations → `migration apply` applies them on `mongodb-memory-server` → introspect database to confirm all configuration matches. Second contract modifying validators and removing indexes → plan produces correct `collMod`/`dropIndex` → apply succeeds.

### Milestone 3: Polymorphic index generation

Auto-derives partial indexes for polymorphic (STI) collections. Depends on the contract carrying discriminator/variants metadata.

**Tasks:**

- [ ] **3.1 Implement polymorphic partial index derivation.** When a collection holds multiple variants, variant-specific field indexes must use `partialFilterExpression` scoped to the discriminator value. The planner derives this automatically from the contract's `discriminator` + `variants` metadata. No user intervention. Unit tests with hand-crafted polymorphic contracts. Integration test: planner output → runner → verify partial indexes on `mongodb-memory-server`.
- [ ] **3.2 End-to-end polymorphic proof.** Contract with a polymorphic collection (base + variants + discriminator) → planner generates partial indexes with correct `partialFilterExpression` → runner applies → partial indexes exist on MongoDB. Integration test with `mongodb-memory-server`.

### Milestone 4: Online CLI commands + live introspection

Adds Mongo support to all CLI commands that interact with a live database. The offline migration path (plan + apply) works after M1, but the remaining `db` and `migration` subcommands need live introspection and generalized wiring.

**Tasks:**

**Live introspection:**

- [ ] **4.1 Implement `introspectSchema` for Mongo.** Read current indexes, validators, and collection options from a live MongoDB instance using `listIndexes` and `listCollections` inspection commands (from the AST built in 1.7a). Produce a `MongoSchemaIR` from the live state — symmetric to `contractToSchema` (1.6). Package placement: `packages/3-mongo-target/`. Integration tests with `mongodb-memory-server`.

**Online `db` commands:**

- [ ] **4.2 Wire `db init` for Mongo.** `db init` bootstraps a database to match the contract with additive-only operations. Generalize the SQL-specific DDL preview branch in `db-init.ts` (`if (familyInstance.familyId === 'sql')`). The planner + runner from M1 do the work; this task wires the CLI path. Integration test.
- [ ] **4.3 Wire `db update` for Mongo.** `db update` reconciles a live database to the contract (additive + widening + destructive with interactive confirmation). Requires live introspection (4.1) to diff live state vs contract. Integration test.
- [ ] **4.4 Wire `db verify` for Mongo.** `db verify` checks marker + live schema vs contract. `--marker-only` needs just the marker read (from 1.10). `--schema-only` and default need live introspection (4.1) to compare the live `MongoSchemaIR` against `contractToSchema` output. Support `--strict` mode. Integration test.
- [ ] **4.5 Wire `db sign` for Mongo.** `db sign` verifies the live schema satisfies the contract, then writes/updates the signature marker. Needs live introspection (4.1) for verification, marker write (from 1.10) for signing. Integration test.
- [ ] **4.6 Wire `db schema` for Mongo.** `db schema` provides read-only live schema introspection with tree or `--json` output. Needs live introspection (4.1) and a Mongo-specific schema formatter. Integration test.

**Online `migration` commands:**

- [ ] **4.7 Wire `migration status --db` for Mongo.** Show applied vs pending migrations against a live database. Needs marker read (from 1.10) and the migration graph (family-agnostic). Offline `migration status` (no `--db`) should already work. Integration test.
- [ ] **4.8 Wire `migration show` for Mongo.** Generalize operation display for Mongo operations (extends work from 1.2). Mongo operations should render their DDL commands in a readable format. Unit test.

### Close-out

- [ ] **C.1 Verify all acceptance criteria in `projects/mongo-schema-migrations/spec.md`.**
- [ ] **C.2 Update MongoDB Family subsystem doc** (`docs/architecture docs/subsystems/10. MongoDB Family.md`): remove "migration runner" from non-goals, add migration system section.
- [ ] **C.3 Update Migration System subsystem doc** (`docs/architecture docs/subsystems/7. Migration System.md`): add Mongo migration examples alongside SQL ones.
- [ ] **C.4 Write ADR for Mongo migration operation vocabulary** (if the op vocabulary is large enough to warrant one; otherwise fold into subsystem doc updates).
- [ ] **C.5 Migrate long-lived docs into `docs/`.** Strip repo-wide references to `projects/mongo-schema-migrations/**`.
- [ ] **C.6 Delete `projects/mongo-schema-migrations/`.**

## Test Coverage

| Acceptance Criterion | Test Type | Task | Notes |
|---|---|---|---|
| SPI refactored to family-hook pattern | Unit | 1.1 | SQL stack passes existing tests through new surface |
| SQL migration stack works through refactored SPI | Unit + Integration | 1.1 | Run existing Postgres migration tests |
| CLI operation display is family-agnostic | Unit | 1.2 | Mock non-SQL operation, verify display |
| `MongoStorageCollection` carries index definitions | Unit (type) | 1.3 | Type shape and construction tests |
| `MongoContractSchema` validates indexes | Unit | 1.4 | Valid/invalid index shapes |
| `MongoSchemaIR` AST represents index state | Unit | 1.5 | Construction, freeze, kind discriminant |
| `contractToSchema` produces `MongoSchemaIR` | Unit | 1.6 | Hand-crafted contracts → expected IR |
| DDL command AST (`CreateIndexCommand`, etc.) | Unit | 1.7a | Construction, freeze, kind discriminant |
| Inspection commands (`ListIndexesCommand`, etc.) | Unit | 1.7a | Construction, freeze |
| Package entrypoint split (`/execution`, `/control`) | Unit | 1.7a | Import paths, export separation |
| `MongoMigrationPlanOperation` symmetric structure | Unit | 1.7b | Construction, JSON serialization round-trip |
| `FilterEvaluator` operator semantics | Unit | 1.7c | `$eq`, `$ne`, `$gt`, `$in`, deep equality, dotted paths |
| `FilterEvaluator` logical combinators | Unit | 1.7c | `$and`, `$or`, `$not`, `$exists` |
| Planner diffs and produces index operations | Unit + Integration | 1.8 | Add/drop/no-op/identity; planner output applied on `mongodb-memory-server` |
| Runner applies `createIndex`/`dropIndex` | Integration | 1.9 | `mongodb-memory-server` |
| Runner generic three-phase loop | Integration | 1.9 | precheck → execute → postcheck flow |
| Runner supports idempotency via postchecks | Integration | 1.9 | Re-apply, postcheck satisfied → skip |
| Marker/ledger in `_prisma_migrations` | Integration | 1.10 | `mongodb-memory-server` |
| Mongo target descriptor exposes migrations | Unit | 1.11 | Descriptor shape assertion |
| CLI `migration plan` works with Mongo | Integration | 1.12 | End-to-end with hand-crafted contract |
| CLI `migration apply` works with Mongo | Integration | 1.12 | End-to-end with `mongodb-memory-server` |
| End-to-end single index | Integration | 1.12 | Plan → apply → verify index exists |
| All index key types | Unit + Integration | 2.1 | Each key type tested |
| All index options | Unit + Integration | 2.2 | Each option tested, identity tests |
| Validator in contract | Unit | 2.3 | Type + Arktype validation |
| Planner generates `collMod` for validators | Unit + Integration | 2.4 | Widening/destructive classification; applied on `mongodb-memory-server` |
| Runner executes validator operations | Integration | 2.5 | `mongodb-memory-server` |
| Collection options in contract | Unit | 2.6 | Type + Arktype validation |
| Planner generates collection option ops | Unit + Integration | 2.7 | New collection + option changes; applied on `mongodb-memory-server` |
| Runner executes collection option ops | Integration | 2.8 | `mongodb-memory-server` |
| Emitter populates enriched collections | Unit | 2.10 | PSL → contract verification |
| End-to-end full vocabulary | Integration | 2.11 | Compound/TTL/partial indexes + validators + collection options on `mongodb-memory-server` |
| Polymorphic partial indexes auto-generated | Unit + Integration | 3.1 | Discriminator → partialFilterExpression; planner output applied on `mongodb-memory-server` |
| End-to-end polymorphic proof | Integration | 3.2 | `mongodb-memory-server` |
| Live introspection produces `MongoSchemaIR` | Integration | 4.1 | `mongodb-memory-server` |
| `db init` works with Mongo target | Integration | 4.2 | Additive-only bootstrap |
| `db update` works with Mongo target | Integration | 4.3 | Interactive destructive confirmation |
| `db verify` works with Mongo target | Integration | 4.4 | `--marker-only`, `--schema-only`, `--strict` |
| `db sign` works with Mongo target | Integration | 4.5 | Verify + write marker |
| `db schema` works with Mongo target | Integration | 4.6 | Tree + `--json` output |
| `migration status --db` works with Mongo | Integration | 4.7 | Applied vs pending |
| `migration show` displays Mongo operations | Unit | 4.8 | Readable DDL command rendering |

## Open Items

- **ORM consolidation dependency (M3):** Polymorphic index generation depends on the contract carrying discriminator/variants metadata. If that shape changes during ORM consolidation, M3 logic may need updating. Low risk: M3 is last and uses hand-crafted contracts for testing.
- **M4 sequencing:** M4 can start after M1 (the offline path must work first). Live introspection (4.1) is the prerequisite for most M4 tasks. M4 tasks for commands that only need the marker (`db verify --marker-only`, `migration status` offline) could theoretically start alongside M1 completion.
- **`contract infer` for Mongo:** The `contract infer` command (infer PSL from live DB) is not in scope. It requires a Mongo-to-PSL reverse mapping which is a separate project.

## Resolved Items

- **SPI refactoring scope (1.1):** Resolved — the existing SPI is already generic enough (`unknown` types, family-agnostic envelope). Task 1.1 is now "validate + wire" not "refactor." If the SPI blocks Mongo, make the minimal change needed.
- **Package placement for schema IR (1.5):** Resolved — `@prisma-next/mongo-schema-ir` at `packages/2-mongo-family/3-tooling/mongo-schema-ir/`, tooling layer, migration plane. Uses its own `MongoSchemaNode` base class (not `MongoAstNode` from the query AST — they are separate language trees).
- **DDL command dispatch:** DDL and inspection commands use visitor dispatch (`accept<R>(visitor): R`), not switch statements. The command executor and CLI formatter are independent visitors on the same AST. See [DDL command dispatch design](specs/ddl-command-dispatch.spec.md). Follow-up [TML-2234](https://linear.app/prisma-company/issue/TML-2234) tracks adding the same pattern to DML commands.
- **CLI display generalization:** Family-aware `extractOperationStatements(familyId, operations)` dispatch. SQL keeps `extractSqlDdl`. Mongo uses `MongoDdlCommandFormatter` visitor. See [CLI display design](specs/cli-display.spec.md).
- **Operation envelope:** Symmetric `precheck[]` / `execute[]` / `postcheck[]` data envelope, designed for later extraction to a framework generic `Operation<Statement>`. See [operation envelope design](specs/operation-envelope.spec.md).
