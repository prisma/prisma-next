# Schema Migrations for MongoDB

## Summary

Extend the migration system to manage MongoDB's server-side configuration (indexes, JSON Schema validators, collection options) through the same graph-based migration model used for SQL DDL. The project proves the migration architecture generalizes beyond SQL by implementing a Mongo planner, runner, schema IR, and target wiring — all against the existing family-agnostic migration SPI.

**Spec:** `projects/mongo-schema-migrations/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Will | Drives execution |
| Reviewer | Saevar | Migration system owner (WS1); CLI generalization coordination |
| Collaborator | ORM consolidation (Will) | Polymorphic contract shape (M3 dependency) |

## Milestones

### Milestone 1: Family migration SPI + vertical slice (single index, end-to-end)

Proves the full migration architecture works for MongoDB by cutting a thin vertical slice through every layer: contract → schema IR → planner → runner → CLI. The simplest case: one ascending index on one collection. Validates with a hand-crafted contract (no authoring/emitter changes needed).

**Tasks:**

**SPI + CLI generalization:**

- [ ] **1.1 Refactor migration SPI to family-hook pattern.** Examine the existing `TargetMigrationsCapability` / `MigrationPlanner` / `MigrationRunner` interfaces. Refactor the surface to follow the family-hook pattern (like `TargetFamilyHook` for emitters). SQL continues to implement through the refactored surface — internals untouched. Write tests verifying the SQL migration stack still works through the new surface.
- [ ] **1.2 Generalize CLI operation display.** Replace or complement `extractSqlDdl` in the CLI with a family-agnostic operation display mechanism. The planner or target provides a formatter; the CLI delegates to it. `migration plan` must preview non-SQL operations. Test with a mock non-SQL operation.

**Contract types:**

- [ ] **1.3 Extend `MongoStorageCollection` with index definitions.** Change `MongoStorageCollection` from `Record<string, never>` to carry `indexes?: ReadonlyArray<MongoStorageIndex>`. For M1, `MongoStorageIndex` supports: ordered fields with key types (`1`, `-1`), `unique` option. Write unit tests for the type shape.
- [ ] **1.4 Update `MongoContractSchema` (Arktype validation).** The Arktype schema currently rejects extra keys on collection entries. Update to accept and validate index definitions. Write validation tests (valid/invalid index shapes).

**Schema IR:**

- [ ] **1.5 Define `MongoSchemaIR` AST.** Following the `MongoAstNode` pattern from `@prisma-next/mongo-query-ast`: abstract base class with `kind` discriminant and `freeze()`, concrete classes `MongoSchemaCollection` and `MongoSchemaIndex`. Union types for matching. Package placement: new package in `packages/2-mongo-family/` (tooling layer, migration plane). Write unit tests for AST construction and freeze behavior.
- [ ] **1.6 Implement `contractToSchema` for Mongo.** Synthesize a `MongoSchemaIR` from a `MongoContract`. When contract is `null` (new project), return empty IR. Lives in `packages/3-mongo-target/`. Write tests with hand-crafted contracts.

**Planner:**

- [ ] **1.7 Define `MongoMigrationPlanOperation` AST classes.** Concrete classes per operation kind: `CreateIndexOp`, `DropIndexOp`. Each extends a common base with the `MigrationPlanOperation` envelope fields (`id`, `label`, `operationClass`) and carries the MongoDB command representation. Following `MongoAstNode` pattern. Write unit tests.
- [ ] **1.8 Implement `MongoMigrationPlanner`.** Diff destination contract against origin `MongoSchemaIR`. For M1: detect added indexes → `CreateIndexOp` (additive), removed indexes → `DropIndexOp` (destructive). Index identity by (collection + ordered fields + key types + semantic options), not by name. Returns `MigrationPlannerResult`. Write unit tests covering: add index, drop index, no-op (same indexes), index identity (same keys different name = equivalent).

**Runner + wiring:**

- [ ] **1.9 Implement `MongoMigrationRunner`.** Execute `CreateIndexOp` / `DropIndexOp` against a MongoDB instance via the Mongo driver. Pre-check: does the index already exist? Post-check: does the index now exist (or not)? Idempotent: if postcheck already satisfied, skip. Uses `mongodb-memory-server` for integration tests.
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
- [ ] **2.4 Extend schema IR and planner for validators.** Add validator representation to `MongoSchemaIR`. Planner generates `UpdateValidatorOp` (new op class) for validator changes. Classify: relaxing validation = `widening`, tightening = `destructive`. Tests for add/remove/change validator.
- [ ] **2.5 Runner executes validator operations.** `collMod` with `$jsonSchema`, `validationLevel`, `validationAction`. Integration tests.

**Collection options:**

- [ ] **2.6 Extend `MongoStorageCollection` with collection options.** Capped settings, time series configuration, collation, change stream pre/post images. Update Arktype schema. Tests.
- [ ] **2.7 Extend schema IR and planner for collection options.** Add `CreateCollectionOp` (with options) and `UpdateCollectionOptionsOp` (via `collMod`) operation classes. Planner detects new collections and option changes. Tests.
- [ ] **2.8 Runner executes collection option operations.** `db.createCollection()` with options, `collMod` for option changes. Integration tests.

**Authoring + emitter:**

- [ ] **2.9 Add PSL authoring support for Mongo indexes.** Support `@@index` and `@@unique` annotations in the Mongo PSL interpreter. Update `@prisma-next/mongo-contract-psl` to populate `storage.collections[].indexes` from annotations. Tests with PSL fixtures.
- [ ] **2.10 Update Mongo emitter to populate enriched `storage.collections`.** Emit index definitions, validator (auto-derived `$jsonSchema` from model field definitions), and collection options into the contract. Tests verifying emitted contracts match expected shapes.

### Milestone 3: Polymorphic index generation

Auto-derives partial indexes for polymorphic (STI) collections. Depends on the contract carrying discriminator/variants metadata.

**Tasks:**

- [ ] **3.1 Implement polymorphic partial index derivation.** When a collection holds multiple variants, variant-specific field indexes must use `partialFilterExpression` scoped to the discriminator value. The planner derives this automatically from the contract's `discriminator` + `variants` metadata. No user intervention. Unit tests with hand-crafted polymorphic contracts.
- [ ] **3.2 End-to-end polymorphic proof.** Contract with a polymorphic collection (base + variants + discriminator) → planner generates partial indexes with correct `partialFilterExpression` → runner applies → partial indexes exist on MongoDB. Integration test with `mongodb-memory-server`.

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
| Planner diffs and produces index operations | Unit | 1.8 | Add/drop/no-op/identity scenarios |
| `MongoMigrationPlanOperation` AST classes | Unit | 1.7 | Construction, envelope fields, freeze |
| Runner applies `createIndex`/`dropIndex` | Integration | 1.9 | `mongodb-memory-server` |
| Runner supports idempotency | Integration | 1.9 | Re-apply same operation, verify skip |
| Marker/ledger in `_prisma_migrations` | Integration | 1.10 | `mongodb-memory-server` |
| Mongo target descriptor exposes migrations | Unit | 1.11 | Descriptor shape assertion |
| CLI `migration plan` works with Mongo | Integration | 1.12 | End-to-end with hand-crafted contract |
| CLI `migration apply` works with Mongo | Integration | 1.12 | End-to-end with `mongodb-memory-server` |
| End-to-end single index | Integration | 1.12 | Plan → apply → verify index exists |
| All index key types | Unit + Integration | 2.1 | Each key type tested |
| All index options | Unit + Integration | 2.2 | Each option tested, identity tests |
| Validator in contract | Unit | 2.3 | Type + Arktype validation |
| Planner generates `collMod` for validators | Unit | 2.4 | Widening/destructive classification |
| Runner executes validator operations | Integration | 2.5 | `mongodb-memory-server` |
| Collection options in contract | Unit | 2.6 | Type + Arktype validation |
| Planner generates collection option ops | Unit | 2.7 | New collection + option changes |
| Runner executes collection option ops | Integration | 2.8 | `mongodb-memory-server` |
| Emitter populates enriched collections | Unit | 2.10 | PSL → contract verification |
| Polymorphic partial indexes auto-generated | Unit | 3.1 | Discriminator → partialFilterExpression |
| End-to-end polymorphic proof | Integration | 3.2 | `mongodb-memory-server` |

## Open Items

- **SPI refactoring scope (1.1):** The spec says "refactor the existing migration SPI to follow the emission pipeline pattern." The investigation shows the existing SPI is already quite generic (`unknown` types, family-agnostic envelope). The refactoring may be smaller than anticipated — possibly just adding an operation formatter hook for CLI display. Determine actual scope early in M1.
- **CLI `db init` SQL branch (1.2):** `db-init.ts` has `if (familyInstance.familyId === 'sql')` for DDL preview. Needs either generalization or a parallel Mongo branch.
- **Package placement for schema IR (1.5):** Exact package name and layer for the Mongo schema IR AST. Options: new package under `packages/2-mongo-family/3-tooling/` (migration plane), or fold into an existing package. Decide at implementation time based on dependency graph.
- **ORM consolidation dependency (M3):** Polymorphic index generation depends on the contract carrying discriminator/variants metadata. If that shape changes during ORM consolidation, M3 logic may need updating. Low risk: M3 is last and uses hand-crafted contracts for testing.
