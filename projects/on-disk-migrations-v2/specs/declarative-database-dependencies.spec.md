# Summary

Replace the Postgres-specific `extensions: readonly string[]` field on `SqlSchemaIR` with a generic `dependencies: DependencyIR[]` node, and simplify `ComponentDatabaseDependency` by removing the ad-hoc `extension` field. Dependencies are identified by their `id`, which the planner and verifier can match structurally without callbacks.

# Description

## Motivating problem

`contractToSchemaIR` converts a contract into a `SqlSchemaIR` for offline migration planning. The planner diffs the "from" schema IR against the "to" contract to produce migration operations. In the online path (`db update`), the "from" schema IR comes from database introspection — extensions are populated by querying `pg_extension`, types from `pg_type`, etc. In the offline path (`migration plan`), there is no database — `contractToSchemaIR` must synthesize the schema IR from the contract and active framework components.

The original `contractToSchemaIR` only received `SqlStorage` (tables). It hardcoded `extensions: []` and ignored `storage.types`. This caused incremental migrations to re-emit `CREATE EXTENSION vector`, `CREATE TYPE user_type`, and other operations that already existed — the planner correctly diffed the incomplete "from" state and concluded they were new.

Passing the full contract to `contractToSchemaIR` fixes the table/type side. But `contractToSchemaIR` also needs to return extensions in the schema IR so the planner doesn't re-emit them. The contract doesn't contain database extension names (only extension pack IDs like `pgvector`, which are namespace identifiers, not database object names). The only source of truth for what a component installs is the component itself — its `databaseDependencies`.

The core problem is that `SqlSchemaIR.extensions: readonly string[]` is a Postgres-specific concept on a family-level type. It couples the schema IR to a particular target's notion of "database extensions." A MySQL target would have no use for this field; future dependencies (schemas, functions, GUC settings) wouldn't fit either.

The fix is to replace `extensions` with a generic `dependencies` array containing `DependencyIR` nodes. Each node carries only an `id` — the same `id` that appears on `ComponentDatabaseDependency`. This makes the schema IR target-agnostic while preserving the planner's ability to diff and decide whether install operations are needed.

## Solutions considered

### Solution 1: Hardcoded extension map in the target (rejected)

Map extension pack IDs to database extension names in the postgres target:

```typescript
const EXTENSION_PACK_TO_DB_EXTENSIONS = { pgvector: ['vector'] };
```

**Rejected because:** Violates ADR 005 (Thin Core, Fat Targets) — the target shouldn't hardcode ecosystem knowledge. Breaks for 3rd-party extensions that the target doesn't know about.

### Solution 2: `ExtensionResolver` callback (rejected)

Pass a target-provided callback that maps extension pack IDs to database extension names:

```typescript
type ExtensionResolver = (packId: string) => readonly string[];
```

**Rejected because:** Still requires the target to maintain a mapping. Inferring database prerequisites from `contract.extensionPacks` violates ADR 154. The extension pack ID (`pgvector`) is a namespace for type/codec/operation registration, not a database extension name.

### Solution 3: `extension` field on `ComponentDatabaseDependency` (implemented, unsatisfactory)

Add `extension?: string` to the dependency interface:

```typescript
interface ComponentDatabaseDependency<TTargetDetails> {
  readonly extension?: string;
  readonly install: readonly SqlMigrationPlanOperation<TTargetDetails>[];
  readonly verifyDatabaseDependencyInstalled: (schema: SqlSchemaIR) => readonly SchemaIssue[];
}
```

`contractToSchemaIR` reads `extension` from each component's dependencies to populate `SqlSchemaIR.extensions`.

**Problems:**
- `extension` is a Postgres-specific concept on a family-level generic interface. MySQL components wouldn't use this field. Future dependencies that require schemas, functions, or GUC settings wouldn't use it either.
- It puts knowledge of database extensions into the SQL family tooling layer, which shouldn't know about them.
- The field exists solely to serve `contractToSchemaIR`'s offline synthesis — it duplicates information already encoded in the `install` ops and the `verifyDatabaseDependencyInstalled` callback.

### Solution 4: `contributeToSchemaIR` callback (considered, not pursued)

Add a callback that produces a schema IR fragment:

```typescript
readonly contributeToSchemaIR?: (schema: SqlSchemaIR) => SqlSchemaIR;
```

**Not pursued because:** Still procedural. The fragment is opaque — the planner can't reason about it or generate operations from it. And it's a second callback alongside `verifyDatabaseDependencyInstalled` that essentially encodes the same information in a different direction.

### Solution 5: Declarative `requires` with `Partial<SqlSchemaIR>` (considered, not pursued)

Replace the procedural interface with a declarative one using schema IR fragments:

```typescript
interface ComponentDatabaseDependency<TTargetDetails> {
  readonly id: string;
  readonly label: string;
  readonly requires: Partial<SqlSchemaIR>;
  readonly install?: readonly SqlMigrationPlanOperation<TTargetDetails>[];
}
```

**Not pursued because:** Over-engineered. `Partial<SqlSchemaIR>` includes fields like `tables` that don't make sense for component dependencies. Merging partial schema IR fragments introduces complexity (deep-merge rules, conflict resolution) that isn't justified when all we really need is an identifier match. The `extensions` field it would contribute to is itself Postgres-specific — using `Partial<SqlSchemaIR>` just moves the coupling rather than removing it.

### Solution 6: Generic `DependencyIR` node on `SqlSchemaIR` (proposed)

Replace the Postgres-specific `extensions: readonly string[]` with a target-agnostic `dependencies: DependencyIR[]`:

```typescript
type DependencyIR = {
  readonly id: string;
};

type SqlSchemaIR = {
  readonly tables: Record<string, SqlTableIR>;
  readonly annotations?: SqlAnnotations;
  readonly dependencies: DependencyIR[];
};
```

The `id` on `DependencyIR` corresponds to the `id` on `ComponentDatabaseDependency`. This gives us:

- **Offline synthesis**: `contractToSchemaIR` collects `{ id: dep.id }` from each component's `databaseDependencies.init[]`. No target-specific fields needed.
- **Online introspection**: The adapter maps introspected database objects to dependency IDs (e.g., `pg_extension` row `vector` → `{ id: 'postgres.extension.vector' }`). The adapter owns this mapping because it owns the dependency declarations.
- **Planner diff**: Dependency present in schema IR means already installed → skip. Missing means emit the component's `install` ops.
- **Verification**: Generic structural check — is the dependency ID present in `schemaIR.dependencies`? Replaces per-component `verifyDatabaseDependencyInstalled` callbacks.

## Extension ecosystem research

Research into popular PostgreSQL extensions reveals three distinct setup patterns:

**Simple extensions** (pgvector, pg_trgm, pgcrypto, uuid-ossp, hstore, ltree): Just `CREATE EXTENSION <name>`. The component provides `install` ops with the appropriate SQL.

**Config-requiring extensions** (pg_stat_statements, pg_cron, TimescaleDB, Citus): Need `shared_preload_libraries` and a server restart before `CREATE EXTENSION` will work. Components for these extensions would include precondition checks in their `install` ops.

**Multi-step extensions** (TimescaleDB's `create_hypertable`, Citus's `create_distributed_table`, pg_partman's `create_parent`): Require additional DDL after `CREATE EXTENSION`. These post-install steps operate on specific user tables and are usage-time decisions, not extension setup — they would be modeled as table-level migration operations, not database dependencies.

All patterns share one thing: the component knows its own identity (`id`) and how to install itself (`install` ops). `DependencyIR` captures the identity; `install` captures the procedure.

# Requirements

## Functional Requirements

### FR-1: Generic dependency representation in schema IR

Replace `SqlSchemaIR.extensions: readonly string[]` with `SqlSchemaIR.dependencies: DependencyIR[]`. Each `DependencyIR` has an `id: string` that matches the `id` on `ComponentDatabaseDependency`.

### FR-2: Remove `extension` field from `ComponentDatabaseDependency`

The `extension?: string` field is removed. The dependency's `id` is already the unique identifier. No additional target-specific fields are needed on the interface.

### FR-3: Offline schema IR synthesis via dependency IDs

`contractToSchemaIR` collects dependency IDs from framework components' `databaseDependencies.init[]` and populates `SqlSchemaIR.dependencies` with `{ id: dep.id }` entries. No component-specific logic — just reads `dep.id`.

### FR-4: Introspection produces dependency IDs

The postgres adapter's introspection maps `pg_extension` rows to `DependencyIR` entries using a convention or mapping owned by the adapter. For example, `pg_extension` row `{ extname: 'vector' }` becomes `{ id: 'postgres.extension.vector' }`. The adapter knows this mapping because it also owns the extension descriptors that declare these IDs.

### FR-5: Planner uses dependency ID presence for skip/emit decision

The planner checks whether each component dependency's `id` is present in `schemaIR.dependencies`:
- Present → already installed, skip
- Missing → emit the component's `install` ops

This replaces the current `verifyDatabaseDependencyInstalled` callback.

### FR-6: Generic verification via dependency ID matching

Schema verification checks whether all required dependency IDs (from active framework components) are present in `schemaIR.dependencies`. This replaces per-component `verifyDatabaseDependencyInstalled` callbacks with a single structural subset check.

### FR-7: `verifyDatabaseDependencyInstalled` callback removed

The callback is removed from `ComponentDatabaseDependency`. Verification is a generic check: "is `dep.id` in `schemaIR.dependencies`?" No component-specific verification logic needed.

## Non-Functional Requirements

- **Target-agnostic schema IR:** `SqlSchemaIR` must not contain target-specific fields. `dependencies` with opaque `id` strings satisfies this.
- **Layering compliance:** The SQL family tooling layer must not know about specific database extensions. Dependency IDs are opaque strings; their meaning is owned by the component that declares them.
- **3rd-party extensibility:** A third-party extension pack declares its `ComponentDatabaseDependency` with an `id` and `install` ops. No changes to core, family, or target packages needed.
- **Online/offline parity:** Same `DependencyIR` structure is used in both paths. Introspection produces it from the live database; `contractToSchemaIR` produces it from framework components. The planner's behavior is identical.

## Non-goals

- Modeling `shared_preload_libraries` or server-restart requirements. These are infrastructure concerns — components can include precondition checks in `install` ops.
- Modeling per-table extension usage (e.g., `create_hypertable`). These are usage-time operations, not setup dependencies.
- Automatic extension version management or upgrades.
- Removing `install` ops from `ComponentDatabaseDependency`. Components still own their installation logic. The `DependencyIR` change is about *identity and presence*, not about who generates the SQL.

# Acceptance Criteria

- [ ] AC-1: `SqlSchemaIR` has `dependencies: DependencyIR[]` instead of `extensions: readonly string[]`.
- [ ] AC-2: `DependencyIR` is `{ readonly id: string }`.
- [ ] AC-3: `ComponentDatabaseDependency` no longer has the `extension?: string` field.
- [ ] AC-4: `verifyDatabaseDependencyInstalled` callback is removed from `ComponentDatabaseDependency`. Verification uses generic dependency ID matching.
- [ ] AC-5: `contractToSchemaIR` populates `dependencies` from `dep.id` of active framework components. No component-specific logic.
- [ ] AC-6: Postgres adapter introspection maps `pg_extension` rows to `DependencyIR` entries (e.g., `{ id: 'postgres.extension.vector' }`).
- [ ] AC-7: The planner skips `install` ops for dependencies already present in `schemaIR.dependencies`, and emits them for missing dependencies.
- [ ] AC-8: Incremental `migration plan` produces only the actual change (e.g., `ADD COLUMN`) and does not re-emit extension operations. Verified by the prisma-next-demo-like test suite.
- [ ] AC-9: A third-party extension pack can declare `ComponentDatabaseDependency` with its own `id` and `install` ops without changes to core, family, or target packages.

# Other Considerations

## Security

No change from current model. `install` ops are provided by framework components (not arbitrary user code). Components are loaded from config, same trust model as today.

## Cost

Engineering time only. No runtime cost change — the planner already generates extension operations; this changes the identity and presence-checking mechanism.

## Observability

No change. The planner already emits operation metadata. Extension operations will have the same `id`/`label`/`operationClass` structure as today.

## Data Protection

No personal data involved. Dependency IDs are non-sensitive metadata.

## Analytics

No change from current tracking.

# References

- `docs/architecture docs/adrs/ADR 154 - Component-owned database dependencies.md`
- `docs/architecture docs/adrs/ADR 005 - Thin Core Fat Targets.md`
- `docs/architecture docs/adrs/ADR 112 - Target Extension Packs.md`
- `docs/architecture docs/adrs/ADR 116 - Extension-aware migration ops.md`
- `docs/architecture docs/adrs/ADR 140 - Package Layering & Target-Family Namespacing.md`
- `docs/architecture docs/subsystems/7. Migration System.md`
- `projects/on-disk-migrations-v2/spec.md` (§ Offline planning: contractToSchemaIR and component-owned extensions)

# Resolved Questions

1. **Postgres adapter maps `pg_extension` rows using `postgres.extension.<extname>` convention.** The adapter owns this convention and extension components must follow it. Documented in the adapter.

2. **`DependencyIR` carries only `id`.** Keeping it minimal means the framework layer can trivially produce it (`components.map(c => ({ id: c.id }))`) without delegating to the extension. Adding more fields would risk pushing production responsibility to extensions.

3. **`verifyDatabaseDependencyInstalled` removed immediately.** No deprecation period — this is a prototype with no external consumers.

4. **ADR 154 updated in-place** to reflect the `DependencyIR` approach. Core principle (component-owned, no inference from extensionPacks) is unchanged.
