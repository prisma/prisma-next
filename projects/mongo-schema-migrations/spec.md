# Summary

Extend the migration system to manage MongoDB's server-side configuration (indexes, JSON Schema validators, collection options) through the same graph-based migration model used for SQL DDL. Define a minimal family migration SPI at the framework level, then spike the Mongo implementation against it.

# Description

MongoDB has a meaningful set of DDL-equivalent operations that need versioning, ordered application, and coordination with data migrations — exactly what the migration system does for SQL. The contract's `storage.collections` section must describe these, the migration planner must diff contract states to generate index/collection operations, and the migration runner must apply them against a real MongoDB instance.

**Three problems if this is deferred:**

1. The migration system is hardening around SQL-only assumptions. Every consumer that stabilizes against SQL-only migration types is a call site to update later.
2. The CLI has SQL-specific display code (`extractSqlDdl`) that will need generalization.
3. MongoDB users have no managed path for index lifecycle — the highest-value migration operation for MongoDB in production.

**Approach: refactor SPI → Mongo implements it.** A migration SPI already exists and works — `TargetMigrationsCapability`, `MigrationPlanner`, `MigrationRunner`, `MigrationPlan` in `@prisma-next/framework-components`, with the CLI delegating through `hasMigrations()` / `getTargetMigrations()`. Following the pattern being established in the emission pipeline refactoring (M6/contract-domain-extraction), refactor the existing SPI to follow the same family-hook pattern (like `TargetFamilyHook` for emitters). SQL continues to implement the refactored SPI — its internals (`SqlMigrationPlanner`, `SqlSchemaIR` diffing, operation generation) stay untouched. Mongo builds its own internals against the same SPI.

**Existing infrastructure:** The graph infrastructure (`@prisma-next/migration-tools`) has zero SQL coupling. The `ContractMarkerRecord` is already a framework-level type. The CLI's operation display (`extractSqlDdl`) is the main SQL-specific code path that needs generalization. The main work is: refactoring the SPI surface, enriching the Mongo contract, building a Mongo planner and runner, and wiring the target descriptor.

**Index authoring:** Users specify indexes explicitly via authoring annotations (PSL `@@index`, `@@unique` or TS DSL equivalents). The emitter translates these into the contract's `storage.collections` section. The vertical slice (M1) uses hand-crafted contracts to prove the migration path; M2 builds the authoring support needed to populate contracts from PSL/TS definitions (the authoring changes are small and built within this project).

# Requirements

## Functional Requirements

Milestones are structured as vertical slices — each milestone cuts through all layers thinly, proving the end-to-end path works before extending breadth.

### Milestone 1: Family migration SPI + vertical slice (single index, end-to-end)

Define the SPI first, then build a thin slice through every layer proving the full path works for the simplest case: one basic index on one collection.

**SPI:**

1. **Refactor the existing migration SPI to follow the emission pipeline pattern.** The SPI (`TargetMigrationsCapability`, `MigrationPlanner`, `MigrationRunner`) already exists and works. Refactor its surface to follow the family-hook pattern being established in M6 (like `TargetFamilyHook` for emitters). SQL continues to implement the refactored SPI — its internals stay untouched. May need a thin extension (e.g. a family-provided operation formatter for CLI display).

2. **Generalize CLI operation display.** Replace or complement `extractSqlDdl` with a family-agnostic operation display mechanism so `migration plan` can preview non-SQL operations.

**Contract:**

3. **Extend `MongoStorageCollection` with index definitions.** Each collection carries an array of index definitions: fields (ordered, with key types like `1`, `-1`), options (`unique`). For the vertical slice, support a single-field ascending index. Index identity follows [ADR 009](../../docs/architecture%20docs/adrs/ADR%20009%20-%20Deterministic%20Naming%20Scheme.md): by (collection + ordered fields with key types + semantic options), not by name.

4. **Update `MongoContractSchema` (Arktype validation).** Currently rejects all extra keys on collection entries. Must accept index definitions.

**Schema IR:**

5. **Define `MongoSchemaIR`.** The representation of "current database state" for diffing — what indexes exist on which collections. Analogous to `SqlSchemaIR`. Start with indexes only.

6. **Implement `contractToSchema` for the Mongo target.** Synthesize a `MongoSchemaIR` from a prior contract for offline planning. When the prior contract is `null` (new project), return an empty IR.

**Planner:**

7. **Implement `MongoMigrationPlanner`.** Diff desired contract state against current `MongoSchemaIR`. For the vertical slice: generate `createIndex` / `dropIndex` operations for added/removed indexes. Classify as `additive` or `destructive`.

8. **Define `MongoMigrationPlanOperation`.** The Mongo-specific operation shape. Carries the MongoDB command representation (e.g. `createIndex` spec). Analogous to `SqlMigrationPlanOperation`.

**Runner + wiring:**

9. **Implement `MongoMigrationRunner`.** Execute `createIndex` / `dropIndex` against a MongoDB instance via the Mongo driver. Pre/post checks for idempotency (does the index already exist?). Simple path: `createIndex()` blocks until complete.

10. **Implement marker read/write for MongoDB.** Store the `ContractMarkerRecord` in a dedicated MongoDB collection (e.g. `prisma_contract.marker`). Reuses the existing framework-level `ContractMarkerRecord` type. Implement `readMarker()` on the Mongo control family instance.

11. **Wire the Mongo target descriptor.** Add `migrations: { createPlanner, createRunner, contractToSchema }` to `@prisma-next/target-mongo`, implementing `TargetMigrationsCapability<'mongo', 'mongo'>`.

**End-to-end proof:** A hand-crafted contract with one index → `migration plan` shows the createIndex operation → `migration apply` creates the index on a real MongoDB instance. A second contract removing that index → plan shows dropIndex → apply drops it.

### Milestone 2: Full index vocabulary + collection options + validators

Extend each layer to cover the full breadth of MongoDB server-side configuration.

**Indexes — full vocabulary:**

12. **Extend index definitions to all key types.** Compound indexes, descending (`-1`), text (`"text"`), geospatial (`"2dsphere"`), wildcard (`"$**"`).

13. **Extend index options.** `unique`, `sparse`, `expireAfterSeconds` (TTL), `partialFilterExpression` (partial indexes).

**Validators:**

14. **Extend `MongoStorageCollection` with validator policy.** The contract carries validation policy: `validationLevel` (`"strict"` | `"moderate"`) and `validationAction` (`"error"` | `"warn"`). The `$jsonSchema` body is auto-generated from the contract's model field definitions (types, nullability) — not stored in the contract.

15. **Planner generates `collMod` operations for validator changes.** Classify as `widening` (relaxing validation) or `destructive` (tightening validation).

**Collection options:**

16. **Extend `MongoStorageCollection` with collection options.** Capped collection settings, time series configuration, collation, change stream pre/post images.

17. **Planner generates `createCollection` with options.** New collections are created with their configured options. Option changes on existing collections produce `collMod` operations where supported.

**Emitter:**

18. **Update the Mongo emitter and authoring surface.** Add PSL/TS authoring support for Mongo index annotations (`@@index`, `@@unique` or equivalents). Update the Mongo emitter to populate the enriched `storage.collections` section from these annotations. Auto-derive `$jsonSchema` validator content from model fields. The authoring changes are small and built within this project.

### Milestone 3: Polymorphic index generation

19. **Auto-derive partial indexes for polymorphic collections.** When a collection holds multiple variants (STI), variant-specific field indexes must use `partialFilterExpression` scoped to the discriminator value. The planner derives this automatically from the contract's `discriminator` + `variants` metadata — no user intervention needed. This is a cross-family concern ([ADR 173 § Indexes on variant-specific fields](../../docs/architecture%20docs/adrs/ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)).

20. **End-to-end polymorphic proof.** A contract with a polymorphic collection (base + variants with discriminator) → planner generates partial indexes with correct `partialFilterExpression` → runner applies them → indexes exist on the MongoDB instance scoped to the correct discriminator values.

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
- **Refactoring SQL migration internals.** SQL's internal migration implementation (`SqlMigrationPlanner`, `SqlSchemaIR` diffing, `SqlMigrationPlanOperation`) stays as-is. Only the SPI surface is refactored; SQL implements the refactored surface without changing its internals.
- **Mongo-native locking.** MongoDB lacks advisory locks. The runner uses optimistic concurrency on the marker record (check-and-update) rather than exclusive locking. Production-grade concurrent apply protection is deferred.

# Acceptance Criteria

### Milestone 1: SPI + vertical slice (single index, end-to-end)
- [ ] Existing migration SPI refactored to follow the emission pipeline family-hook pattern
- [ ] SQL migration stack continues to work through the refactored SPI (internals untouched)
- [ ] CLI operation display is family-agnostic (not SQL-only)
- [ ] `MongoStorageCollection` type carries index definitions
- [ ] `MongoContractSchema` (Arktype) validates index definitions on collections
- [ ] `MongoSchemaIR` type represents current index state
- [ ] `contractToSchema` produces a `MongoSchemaIR` from a `MongoContract` (or empty IR from `null`)
- [ ] `MongoMigrationPlanner.plan()` diffs two contract states and produces index operations
- [ ] `MongoMigrationPlanOperation` carries MongoDB command representations
- [ ] `MongoMigrationRunner.execute()` applies `createIndex`/`dropIndex` against a real MongoDB instance
- [ ] Runner supports idempotency (pre/post checks)
- [ ] `ContractMarkerRecord` is stored in and read from a MongoDB collection
- [ ] Mongo target descriptor exposes `migrations` capability
- [ ] `migration plan` CLI command works with a Mongo target
- [ ] `migration apply` CLI command works with a Mongo target
- [ ] End-to-end: hand-crafted contract with one index → plan → apply → index exists on MongoDB

### Milestone 2: Full vocabulary
- [ ] All index key types supported: ascending, descending, compound, text, geospatial, wildcard
- [ ] All index options supported: unique, sparse, TTL, partial
- [ ] Validator policy in contract (level, action); `$jsonSchema` auto-generated from model fields
- [ ] Planner generates `collMod` for validator changes, classified as widening or destructive
- [ ] Collection options in contract: capped, time series, collation, change stream pre/post images
- [ ] Planner generates `createCollection` with options
- [ ] Mongo emitter populates enriched `storage.collections` from authoring annotations

### Milestone 3: Polymorphic indexes
- [ ] Polymorphic collections auto-generate partial indexes with `partialFilterExpression` derived from discriminator/variants
- [ ] End-to-end: polymorphic contract → plan → apply → partial indexes exist on MongoDB scoped to discriminator values

### End-to-end proof (from April milestone)
- [ ] A contract diff between two Mongo contract states produces correct index creation/deletion operations
- [ ] The migration runner applies them against a real MongoDB instance
- [ ] Partial indexes for polymorphic collections are generated correctly

# Other Considerations

## Coordination

- **Saevar (migration system, WS1):** The migration system's graph model, on-disk format, and CLI commands are owned by WS1. This project adds a new family implementation but doesn't change the graph model. CLI generalization (replacing `extractSqlDdl`) needs coordination.
- **ORM consolidation (Will):** Polymorphic index generation (M3) depends on the contract carrying discriminator/variants metadata, which is being implemented in the ORM consolidation project (Phase 1.75b). M1 and M2 can proceed independently.
- **Contract domain extraction:** `ContractBase` extraction (P1 item 1) is a soft dependency. This project can work with current `MongoContract` and adopt `ContractBase` later.

## Risk

- **Polymorphic index generation depends on contract shape (M3).** If the contract's polymorphism representation changes during ORM consolidation, the partial index derivation logic may need updating. Mitigated by M3 being sequenced last and testable with hand-crafted contracts.

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

None — all resolved during shaping. See conversation summary in commit history.
