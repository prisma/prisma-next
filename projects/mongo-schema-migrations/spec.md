# Summary

Extend the migration system to manage MongoDB's server-side configuration (indexes, JSON Schema validators, collection options) through the same graph-based migration model used for SQL DDL. Define a minimal family migration SPI at the framework level, then spike the Mongo implementation against it.

# Description

MongoDB has a meaningful set of DDL-equivalent operations that need versioning, ordered application, and coordination with data migrations — exactly what the migration system does for SQL. The contract's `storage.collections` section must describe these, the migration planner must diff contract states to generate index/collection operations, and the migration runner must apply them against a real MongoDB instance.

**Three problems if this is deferred:**

1. The migration system is hardening around SQL-only assumptions. Every consumer that stabilizes against SQL-only migration types is a call site to update later.
2. The CLI has SQL-specific display code (`extractSqlDdl`) that will need generalization.
3. MongoDB users have no managed path for index lifecycle — the highest-value migration operation for MongoDB in production.

**Approach: define SPI → spike Mongo → extract later.** Following the pattern established in M6 (contract-domain-extraction), define a minimal family migration SPI at the framework level. Build the Mongo implementation against it. Don't refactor SQL to use the new SPI yet — extract shared patterns from both implementations after the Mongo spike proves out.

**Existing infrastructure:** The framework-level migration SPI (`TargetMigrationsCapability`, `MigrationPlanner`, `MigrationRunner`, `MigrationPlan`) is already family-agnostic in type terms (`contract: unknown`, `schema: unknown`). The graph infrastructure (`@prisma-next/migration-tools`) has zero SQL coupling. The `ContractMarkerRecord` is already a framework-level type. The main work is: enriching the Mongo contract, building a planner and runner, and wiring the target descriptor.

# Requirements

## Functional Requirements

### Milestone 1: Contract schema enrichment

1. **Extend `MongoStorageCollection` with index definitions.** Each collection carries an array of index definitions: fields (ordered, with key types like `1`, `-1`, `"text"`, `"2dsphere"`), options (`unique`, `sparse`, `expireAfterSeconds`, `partialFilterExpression`). Index identity follows [ADR 009](../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md): by (collection + ordered fields with key types + semantic options), not by name.

2. **Extend `MongoStorageCollection` with validator policy.** The contract carries validation policy: `validationLevel` (`"strict"` | `"moderate"`) and `validationAction` (`"error"` | `"warn"`). The `$jsonSchema` body is auto-generated from the contract's model field definitions (types, nullability) — not stored in the contract.

3. **Extend `MongoStorageCollection` with collection options.** Capped collection settings, time series configuration, collation, change stream pre/post images.

4. **Update `MongoContractSchema` (Arktype validation).** Currently rejects all extra keys on collection entries. Must accept the new index/validator/collection option shapes.

5. **Update the Mongo emitter.** Populate the enriched `storage.collections` section from the contract's model definitions. Auto-generate index definitions from model field annotations (e.g. `@unique`, `@index`). Auto-derive `$jsonSchema` validator content from model fields for runtime use by the planner.

### Milestone 2: Schema IR + contract-to-schema

6. **Define `MongoSchemaIR`.** The representation of "current database state" for diffing — what indexes, validators, and collection options exist. Analogous to `SqlSchemaIR`.

7. **Implement `contractToSchema` for the Mongo target.** Synthesize a `MongoSchemaIR` from a prior contract for offline planning (same pattern as SQL's `contractToSchemaIR`). When the prior contract is `null` (new project), return an empty IR.

### Milestone 3: MongoMigrationPlanner

8. **Implement `MongoMigrationPlanner`.** Diff desired contract state (from target contract) against current `MongoSchemaIR` (from prior contract or introspection). Generate operations:
   - `createIndex` / `dropIndex` for added/removed indexes
   - `createCollection` with options for new collections
   - `collMod` for validator policy updates
   - Operation classification: `additive` (new index, new collection), `widening` (relaxing validator), `destructive` (dropping index, tightening validator)

9. **Auto-derive partial indexes for polymorphic collections.** When a collection holds multiple variants (STI), variant-specific field indexes must use `partialFilterExpression` scoped to the discriminator value. The planner derives this automatically from the contract's `discriminator` + `variants` metadata — no user intervention needed. This is a cross-family concern ([ADR 173 § Indexes on variant-specific fields](../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)).

10. **Define `MongoMigrationPlanOperation`.** The Mongo-specific operation shape. Analogous to `SqlMigrationPlanOperation` (which carries `precheck`/`execute`/`postcheck` as SQL strings). Mongo operations carry the MongoDB command representation (e.g. `createIndex` spec, `collMod` command).

### Milestone 4: MongoMigrationRunner + target wiring

11. **Implement `MongoMigrationRunner`.** Execute operations against a MongoDB instance via the Mongo driver. Pre/post/idempotency checks (e.g. does the index already exist? did creation succeed?). For index builds, use the simple path: call `createIndex()` and wait for completion. Progress monitoring is deferred.

12. **Implement marker read/write for MongoDB.** Store the `ContractMarkerRecord` in a dedicated MongoDB collection (e.g. `prisma_contract.marker`). Reuses the existing framework-level `ContractMarkerRecord` type. Implement `readMarker()` on the Mongo control family instance.

13. **Wire the Mongo target descriptor.** Add `migrations: { createPlanner, createRunner, contractToSchema }` to `@prisma-next/target-mongo`, implementing `TargetMigrationsCapability<'mongo', 'mongo'>`.

14. **Generalize CLI operation display.** Replace or complement `extractSqlDdl` with a family-agnostic operation display mechanism so `migration plan` can preview Mongo operations.

### Milestone 5: Family migration SPI

15. **Define minimal family migration SPI.** Following the M6 emitter hook pattern: define interfaces at the framework level that families implement. The existing `TargetMigrationsCapability` / `MigrationPlanner` / `MigrationRunner` may already suffice, or may need a thin extension (e.g. a family-provided operation formatter for CLI display). Don't refactor SQL to use it yet.

## Non-Functional Requirements

- **Index identity by properties.** Following [ADR 009](../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md), indexes are identified by (collection + ordered fields with key types + semantic options), not by name. Name differences are ignored for matching; names are for DDL/diagnostics.
- **Validator auto-generation.** `$jsonSchema` content is derived from contract model fields at planner time, not stored in the contract. The contract carries only validation policy.
- **Reuse `ContractMarkerRecord`.** The marker record schema is already framework-level. Mongo implementation stores it in a MongoDB collection using the same type.
- **Simple index build path.** `createIndex()` blocks until complete. No async progress monitoring in v1.

## Non-goals

- **Data migrations for MongoDB.** Document content transformations (field renames, type changes) are a separate project ([April milestone P1 item 5](../../docs/planning/april-milestone.md)). The schema migration infrastructure is a prerequisite.
- **Atlas-specific operations.** Atlas Search indexes and Vector Search indexes use a different API (Atlas Admin API). Whether these belong in core or in an extension pack is deferred.
- **Rolling index build monitoring.** Progress reporting for long-running index builds on large collections is deferred.
- **Introspection from live MongoDB.** Reading current indexes/validators/options from a live MongoDB instance (for `migration status` / drift detection) is valuable but not required for the proof. Can be added after offline planning works.
- **Refactoring SQL migrations to the new SPI.** The SQL migration stack stays as-is. Extraction of shared patterns happens after the Mongo spike proves out.
- **Mongo-native locking.** MongoDB lacks advisory locks. The runner uses optimistic concurrency on the marker record (check-and-update) rather than exclusive locking. Production-grade concurrent apply protection is deferred.

# Acceptance Criteria

### Milestone 1: Contract schema enrichment
- [ ] `MongoStorageCollection` type carries index definitions with fields, key types, and options
- [ ] `MongoStorageCollection` type carries validator policy (level, action)
- [ ] `MongoStorageCollection` type carries collection options (capped, time series, collation)
- [ ] `MongoContractSchema` (Arktype) validates the enriched collection shape
- [ ] Mongo emitter populates `storage.collections` with index and validator data from model definitions

### Milestone 2: Schema IR
- [ ] `MongoSchemaIR` type represents current database state (indexes, validators, collection options)
- [ ] `contractToSchema(contract)` produces a `MongoSchemaIR` from a `MongoContract`
- [ ] `contractToSchema(null)` produces an empty `MongoSchemaIR`

### Milestone 3: Planner
- [ ] `MongoMigrationPlanner.plan()` diffs two contract states and produces `MongoMigrationPlan`
- [ ] Plan includes `createIndex` operations for new indexes
- [ ] Plan includes `dropIndex` operations for removed indexes
- [ ] Plan includes `createCollection` operations for new collections with options
- [ ] Plan includes `collMod` operations for validator policy changes
- [ ] Operations are classified as `additive`, `widening`, or `destructive`
- [ ] Polymorphic collections generate partial indexes with `partialFilterExpression` auto-derived from discriminator/variants

### Milestone 4: Runner + wiring
- [ ] `MongoMigrationRunner.execute()` applies operations against a real MongoDB instance
- [ ] Runner pre/post checks verify operation success and support idempotency
- [ ] `ContractMarkerRecord` is stored in and read from a MongoDB collection
- [ ] Mongo target descriptor exposes `migrations` capability
- [ ] `migration plan` CLI command works with a Mongo target (displays Mongo operations)
- [ ] `migration apply` CLI command works with a Mongo target

### Milestone 5: SPI
- [ ] Family migration SPI defined at framework level
- [ ] Mongo target implements the SPI
- [ ] CLI delegates to the SPI without SQL-specific code paths

### End-to-end proof (from April milestone)
- [ ] A contract diff between two Mongo contract states produces correct index creation/deletion operations
- [ ] The migration runner applies them against a real MongoDB instance
- [ ] Partial indexes for polymorphic collections are generated correctly

# Other Considerations

## Coordination

- **Saevar (migration system, WS1):** The migration system's graph model, on-disk format, and CLI commands are owned by WS1. This project adds a new family implementation but doesn't change the graph model. CLI generalization (replacing `extractSqlDdl`) needs coordination.
- **ORM consolidation (Will):** Polymorphic index generation (M3/M5) depends on the contract carrying discriminator/variants metadata, which is being implemented in the ORM consolidation project (Phase 1.75b). Non-polymorphic milestones can proceed independently.
- **Contract domain extraction:** The `ContractBase` extraction (P1 item 1) is soft-dependency. This project can work with current `MongoContract` and adopt `ContractBase` later.

## Risk

- **Emitter changes may be larger than expected.** The Mongo emitter currently produces minimal `storage.collections` entries. Populating indexes, validators, and collection options requires PSL/TS authoring support for index annotations — this may need coordination with the contract authoring workstream (WS2).
- **Polymorphic index generation depends on contract shape.** If the contract's polymorphism representation changes during ORM consolidation, the partial index derivation logic may need updating. Mitigated by testing with hand-crafted contracts first.

# References

- [April milestone plan](../../docs/planning/april-milestone.md) § WS4, task 4
- [mongo-schema-migrations design doc](../../docs/planning/mongo-target/1-design-docs/mongo-schema-migrations.md)
- [ADR 009 — Deterministic Naming Scheme](../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md)
- [ADR 172 — Contract domain-storage separation](../../docs/architecture%20docs/adrs/ADR%20172%20-%20Contract%20domain-storage%20separation.md)
- [ADR 173 — Polymorphism via discriminator and variants](../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)
- [ADR 176 — Data migrations as invariant-guarded transitions](../../docs/architecture%20docs/adrs/ADR%20176%20-%20Data%20migrations%20as%20invariant-guarded%20transitions.md)
- Framework migration SPI: `packages/1-framework/1-core/framework-components/src/control-migration-types.ts`
- SQL migration implementation: `packages/2-sql/9-family/src/core/migrations/`
- Postgres planner/runner: `packages/3-targets/3-targets/postgres/src/core/migrations/`
- Mongo contract types: `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-types.ts`
- Mongo target descriptor: `packages/3-mongo-target/1-mongo-target/src/core/descriptor-meta.ts`
- `ContractMarkerRecord`: `packages/1-framework/0-foundation/contract/src/types.ts`

# Open Questions

1. **Emitter dependency on authoring.** The Mongo emitter needs to populate `storage.collections` from model definitions. Does this require PSL/TS authoring support for index annotations (e.g. `@@index`, `@@unique` in PSL), or can the emitter derive indexes from other model metadata (e.g. `@id`, `@unique` field-level attributes that already exist)?

2. **Milestone sequencing: SPI first or last?** The spec lists SPI extraction as Milestone 5, but it could also be Milestone 1 (define the interface first, then implement against it). The M6 pattern suggests defining the interface early. Which sequencing do you prefer?

3. **Collection options scope.** Capped collections, time series, and collation are included in the contract schema enrichment. Are all three needed for the proof, or is indexes-only sufficient for the April milestone stop condition?
