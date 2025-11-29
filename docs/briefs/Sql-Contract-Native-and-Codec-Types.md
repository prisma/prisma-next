# Project Brief: SQL Contract Native and Codec Types

## Goals

For the SQL family, we want the **contract** to carry enough information to support two distinct concerns without any external configuration:

- **Database structure verification and migration planning**
  - By looking only at the contract and a live `SqlSchemaIR` snapshot, downstream tools should be able to:
    - Decide whether the database schema satisfies the contract.
    - Plan additive/widening migrations (`db init`, `db update`) without needing codec registries, manifests, or config files.
- **Query-builder and runtime configuration**
  - Query DSLs and runtime codecs should be able to use the same contract to:
    - Determine which codec to use for each column.
    - Infer correct JS types for query results.

To make this possible, **each SQL column in the contract must encode both**:

- A **native database type identifier** (what the DB actually stores: e.g. `int4`, `text`, `vector`).
- A **codec identifier** (application/runtime configuration: e.g. `pg/int4@1`, `pg/text@1`, `pg/vector@1`).

In other words:

- From a **purity** viewpoint, codec IDs are application config and arguably don’t belong in the contract.
- From a **pragmatic** viewpoint, we accept this impurity so that:
  - We don’t need a separate “column → codec” mapping artifact.
  - Query builders and control-plane tools can both operate from **one canonical source**: the SQL contract IR.

---

## Current State

### Contract vs Schema Types

Today, for the SQL family:

- Contract storage columns (`StorageColumn` in `@prisma-next/sql-contract`) expose a `type` field that is a **codec type ID**, e.g.:
  - `'pg/int4@1'`
  - `'pg/text@1'`
  - `'pg/vector@1'`
- The SQL schema IR (`SqlSchemaIR` in `@prisma-next/sql-schema-ir`) exposes `SqlColumnIR.typeId` as a **native DB type**, e.g.:
  - `'int4'`
  - `'text'`
  - `'vector'`

The Slice 1 migration planner implementation (`planMigration` in `@prisma-next/sql-migrations`) currently compares:

```ts
// Simplified
if (contractColumn.type !== schemaColumn.typeId) {
  return false;
}
```

This is conceptually wrong: it compares a **codec ID** to a **native type ID**.

### Type Metadata Registry

We already have a shared **SQL type metadata registry** (see `docs/briefs/Sql-Type-Metadata-Registry.md`):

- Built in `@prisma-next/family-sql` from manifests of:
  - Target pack (`targets-postgres`).
  - Adapter pack (`targets-postgres-adapter`).
  - Extension packs (`extensions/pgvector`, etc.).
- Maps `typeId` (codec ID, e.g. `'pg/int4@1'`) to:
  - `nativeType` (e.g. `'integer'`, `'timestamp with time zone'`, `'vector'`).

This registry is used by **schema verification** and is available to the planner in the SQL family instance, but:

- The **contract itself** only stores codec IDs.
- The **marker’s stored contract JSON** is just the canonical contract; it also lacks native types.
- Tools that have **only**:
  - The marker’s `contract_json`, and
  - The live `SqlSchemaIR`,
  cannot compare contract types to schema types without re-attaching manifests/config.

---

## Problem Statement

Given the current shapes:

- `StorageColumn.type` is a codec ID.
- `SqlColumnIR.typeId` is a native DB type.

Several issues arise:

1. **Contract-only DB verification is not possible**
   - Downstream tools that see only:
     - Marker’s `contract_json` (as stored in `prisma_contract.marker`), and
     - A live `SqlSchemaIR` from introspection,
   - Cannot decide type compatibility without reconstructing codec→native mappings from manifests.

2. **Planner conflicts are misdetected**
   - `planMigration` currently compares codec ID to native type ID.
   - This will:
     - Treat compatible columns (same native type, correct codec) as incompatible.
     - Fail to distinguish real type mismatches from codec aliasing cases.

3. **Schema verification requires manifests/config**
   - `db schema-verify` and similar tools can’t be pointed at “contract + DB URL” alone; they need:
     - Family/target/adapter/extension descriptors.
     - Manifests to reconstruct codec→native mappings.
   - This complicates **downstream integrations** that only have a contract + DB access.

4. **The contract doesn’t clearly reflect DB structure**
   - A contract that only lists codec IDs is not a faithful description of the **database’s storage layout**.
   - This makes it harder to reason about “what’s actually in the DB” from the contract alone.

At the same time, we cannot simply remove codec IDs from the contract:

- Query builders and runtime need to know which codec to apply for each column.
- We want them to get this information from the same contract used for structure, not from a separate mapping layer.

---

## Proposed Contract Shape (SQL Family)

### Column Representation

For the SQL family, we will refactor the `StorageColumn` shape in `@prisma-next/sql-contract` to explicitly model **both** native type and codec configuration for each column.

At the type level (names are examples, final naming to be decided during implementation):

```ts
// Today (simplified)
type StorageColumn = {
  type: string;           // codec ID, e.g. 'pg/int4@1'
  nullable: boolean;
  // ...
};

// Proposed (SQL family)
type SqlStorageColumn = {
  // Native DB type identifier (for structure, verification, migrations).
  // This should align with SqlSchemaIR.SqlColumnIR.typeId.
  nativeType: string;     // e.g. 'int4', 'text', 'vector'

  // Codec identifier (for query builders and runtime codecs).
  // Required - contracts must be consumable by both application and database.
  codecId: string;       // e.g. 'pg/int4@1', 'pg/text@1', 'pg/vector@1'

  nullable: boolean;
  default?: unknown;
  // Other structural properties...
};
```

Design notes:

- **Native type is authoritative for DB structure**
  - All DB-structure operations (schema verify, migration planning, `db init`, `db update`) use `nativeType` to compare against `SqlSchemaIR.typeId`.
  - Codec IDs are ignored for structural compatibility checks.

- **Codec ID is an overlay**
  - Query builders and runtime code treat `codecId` as:
    - The handle for selecting codecs from registries.
    - The source for JS type inference.
  - It is application configuration, but we accept having it in the contract for pragmatic reasons.

- **Hashing / `coreHash`**
  - For the SQL family, both `nativeType` and `codecId` are part of the canonical contract IR:
    - Changing either changes `coreHash`.
  - This reflects the idea that:
    - A change to storage type is a **contract breaking** change.
    - A change to codec configuration can also be contract-significant for applications (e.g. switching JSON vs text encoding).

### Family-Specific Contract Types

To avoid impacting non-SQL families:

- The enriched column shape applies to the **SQL-specific contract types** in `@prisma-next/sql-contract`:
  - `SqlContract<SqlStorage>`.
  - `SqlStorage.tables.*.columns.*` use `SqlStorageColumn` with `nativeType` and `codecId`.
- Core contract types used by other families are unaffected.

---

## Interaction with the SQL Type Metadata Registry

The **SqlTypeMetadataRegistry** remains the single source of truth for:

- Mapping codec IDs (e.g. `'pg/int4@1'`) to:
  - `nativeType` (e.g. `'integer'` or `'int4'`).
  - Family ID and target ID (e.g. `'sql'`, `'postgres'`).

However, its role shifts slightly:

- **Before**:
  - Registry is required at verification/planning time to derive native types from codec IDs.
  - Contract itself only stores codec IDs; native types are “discovered” on demand via the registry.

- **After**:
  - Registry is used primarily at **contract construction** time to populate `nativeType` fields:
    - Authoring surfaces (TS builder, PSL emitter, SQL family emitter) will:
      - Choose codec IDs based on author input.
      - Use the type metadata registry to derive the canonical `nativeType` for each column.
  - Registry can still be used at verification/planning time to:
    - Sanity-check that `codecId` and `nativeType` agree (if both present).
    - Provide richer metadata (category, array-ness, etc.) for future features.

This keeps:

- Contract IR **self-sufficient** for:
  - Schema verification.
  - Migration planning.
  - Query building.
- Type registry as an implementation detail for:
  - Authoring normalization.
  - Additional validation.

---

## Impacted Components

### 1. SQL Contract Types and Validation

**Packages:**

- `@prisma-next/sql-contract` (types, Arktype schemas, validators).
- `@prisma-next/sql-contract-ts` (TS contract builder/validation).

Changes:

- Update SQL-specific contract types to use `nativeType` + required `codecId` for columns.
- Update Arktype schemas to validate the new shape:
  - `nativeType: string` required.
  - `codecId: 'string'` required.
- Ensure `validateContract<SqlContract<SqlStorage>>`:
  - Enforces presence of both `nativeType` and `codecId` for SQL columns.

### 2. SQL Contract Authoring & Emission

**Packages:**

- SQL TS contract builder (`sql-contract-ts` authoring).
- SQL contract emitter / family hook (`@prisma-next/sql-contract-emitter`).

Changes:

- When building/emitting SQL contracts:
  - For each storage column:
    - Determine `codecId` (from authoring input, builder API, or mappings).
    - Use the **SqlTypeMetadataRegistry** (or equivalent mapping helper) to:
      - Lookup `nativeType` for that `codecId` and target.
    - Write both into the contract IR:
      - `nativeType` (required).
      - `codecId` (required).
- Ensure that authoring surfaces:
  - Require codec IDs explicitly for all columns.

### 3. Schema Verification (`db schema-verify`)

**Packages:**

- SQL family (`@prisma-next/family-sql`), particularly `schemaVerify` implementation.
- CLI command: `docs/Db-Schema-Verify-Command.md` and associated code.

Changes:

- Adjust schema verification logic to:
  - Compare `contractColumn.nativeType` directly to `SqlSchemaIR.table.column.typeId`.
  - Apply nullability and other structural rules as today.
  - Ignore `codecId` for structural comparison.
- Optionally:
  - Use the type registry at verification time to:
    - Check that `codecId` and `nativeType` agree with manifests.
    - Emit warnings or errors when they diverge.

Downstream tools that only have:

- `marker.contract_json` (which now includes `nativeType`), and
- `SqlSchemaIR`,

can perform complete structural verification with no manifests/config.

### 4. Migration Planner (`planMigration`) and `db init` / `db update`

**Packages:**

- `@prisma-next/sql-migrations` (planner and IR).
- `@prisma-next/family-sql` (family-owned `planMigration`).
- Future `db init` / `db update` CLI code.

Changes:

- Update `columnTypeCompatible` and any similar comparisons to:

  ```ts
  // New comparison
  if (contractColumn.nativeType !== schemaColumn.typeId) {
    return false; // type mismatch
  }
  // Nullability logic remains as in Slice 1
  ```

- Codec IDs are not considered for compatibility in the planner (only `nativeType` is used):
  - If we later want to plan codec-level changes, they can be modeled as extension or application-level operations, not as structural schema changes.

This aligns migration planning with the new contract shape and makes it robust for tools that only see contract + schema.

### 5. Query Builders and Runtime

**Packages:**

- SQL lane (`@prisma-next/sql-lane`).
- ORM lane (`@prisma-next/sql-orm-lane`).
- Runtime/execution layer (`@prisma-next/runtime`, SQL runtime).

Changes:

- Update builders that currently read `StorageColumn.type` as a codec ID to instead read `codecId`:
  - This is largely a mechanical rename and field change.
- All columns must have `codecId` present - no default behavior needed.

The key point: query builders remain codec-driven and can always rely on `codecId` being present.

### 6. Marker and Downstream Tools

**Marker:**

- `prisma_contract.marker.contract_json` can now be the **same enriched SQL contract IR**:
  - Columns contain `nativeType` and `codecId`.
  - No special projection is required just for the marker.

**Downstream tools:**

- Tools that only have:
  - The marker’s contract JSON, and
  - Access to introspection (`SqlSchemaIR`),
  - Can:
    - Validate schema vs contract by comparing `nativeType` to `typeId`.
    - Optionally analyze codec usage via `codecId` if needed.

---

## Implementation Plan

This section outlines a concrete, multi-step plan to move from the current implementation to the proposed design.

### Step 1: Update SQL Contract Types and Schemas

- [ ] In `@prisma-next/sql-contract`:
  - [ ] Introduce `nativeType` and `codecId` on the SQL-specific `StorageColumn` type.
  - [ ] Update Arktype schemas to validate:
    - `nativeType: 'string'` (required).
    - `codecId: 'string'` (required).
  - [ ] Keep existing `type` property for backward compatibility if needed, or:
    - [ ] Deprecate/replace it with `codecId` in a structured way.

- [ ] In `@prisma-next/sql-contract-ts`:
  - [ ] Update TS contract builder surfaces to:
    - Accept or derive both `nativeType` and `codecId`.
    - Normalize abbreviations/aliases for native types as needed.

### Step 2: Populate Native Types at Contract Construction Time

- [ ] In SQL contract authoring/emission (TS builder and PSL emitter):
  - [ ] For each column:
    - [ ] Determine `codecId` from author input or defaults.
    - [ ] Use `SqlTypeMetadataRegistry` (or a helper built over manifests) to:
      - [ ] Look up the canonical `nativeType` for that `codecId` and target.
    - [ ] Write both `nativeType` and `codecId` into the contract.

- [ ] Ensure that:
  - [ ] Both `codecId` and `nativeType` are always present for all columns.
  - [ ] If registry has no `nativeType` for `codecId`:
    - Treat this as a validation error in authoring.

### Step 3: Update Schema Verification to Use Native Types

- [ ] In SQL family `schemaVerify` implementation:
  - [ ] Change type comparison to:
    - Compare `contractColumn.nativeType` to `SqlSchemaIR.table.column.typeId`.
  - [ ] Retain existing nullability and other structural checks.
  - [ ] Optionally:
    - [ ] Use `codecId` + type registry to validate that `nativeType` and codec metadata agree.

- [ ] Update `docs/Db-Schema-Verify-Command.md` to reflect:
  - Contract columns encode native DB types.
  - Schema verification uses native types for compatibility.

### Step 4: Update Migration Planner to Use Native Types

- [ ] In `@prisma-next/sql-migrations`:
  - [ ] Refactor `columnTypeCompatible` to:
    - Compare `contractColumn.nativeType` to `schemaColumn.typeId`.
    - Apply nullability rules unchanged.
  - [ ] Remove any direct comparison of codec ID to native type ID.

- [ ] In SQL family `planMigration` wrapper:
  - [ ] Ensure we still call `validateContract<SqlContract<SqlStorage>>()` before planning.
  - [ ] Consider adding optional sanity checks that `codecId` and `nativeType` are consistent (using the type registry).

- [ ] Update or add tests for:
  - Matching native types (including pgvector types).
  - Mismatched native types causing `SqlMigrationPlanningError`.

### Step 5: Adjust Query Builders and Runtime

- [ ] In SQL lane and ORM lane:
  - [ ] Update all usages of `StorageColumn.type` (as codec ID) to use `codecId`.
  - [ ] All columns must have `codecId` - treat missing `codecId` as an error.

- [ ] In runtime:
  - [ ] Ensure plan building and result decoding are wired only to `codecId`, not `nativeType`.

### Step 6: Marker and Tooling Updates

- [ ] Confirm that `prisma_contract.marker.contract_json` stores the enriched SQL contract IR:
  - [ ] Columns include `nativeType` and `codecId`.
  - [ ] No separate projection is required for marker storage.

- [ ] Update any downstream tools that:
  - [ ] Parse the marker’s contract JSON for schema checks:
    - Switch them to use `nativeType` for structural comparisons.
    - Optionally inspect `codecId` for higher-level analysis.

### Step 7: Documentation and ADR Touchpoints

- [ ] Update or augment:
  - [ ] `docs/architecture docs/subsystems/2. Contract Emitter & Types.md` (or equivalent) to describe the SQL contract’s column shape.
  - [ ] `docs/Db-Init-Command.md` and `docs/architecture docs/Contract-Driven DB Update.md` to:
    - Clarify that DB structure checks use native types from the contract.
  - [ ] `docs/briefs/Sql-Type-Metadata-Registry.md` to:
    - Note that the registry is now used at contract construction time to populate `nativeType`.

---

With this refactor, the SQL family’s contract IR becomes a **complete description of both database structure and codec configuration**. Tools that only have:

- The contract (including the DB-stored marker) and
- A live schema snapshot

can perform meaningful structural verification and migration planning purely from native types, while query builders and runtime remain codec-aware using the same contract. This aligns the contract more closely with the actual database while still serving as a single source of truth for application-level configuration.***


