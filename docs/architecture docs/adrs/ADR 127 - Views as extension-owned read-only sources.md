# ADR 127 — Views as extension-owned read-only sources

> Note: This ADR predates the provider-based authoring direction and the decision that canonical `contract.json` must have **no** top-level `sources` field (see [ADR 006 — Dual Authoring Modes](ADR%20006%20-%20Dual%20Authoring%20Modes.md)).
>
> The “publish views into `contract.sources`” mechanism described below should be treated as **deprecated** until this ADR is revised to match the “no top-level `sources` field” guarantee. Views remain extension-owned; the surfacing mechanism for type-safe querying must not rely on a canonical root `sources` registry.

## Context

Database views and materialized views are widely used but vary significantly across targets in definition, materialization, refresh semantics, and performance characteristics. Making views a core object would bloat the contract, couple us to dialect semantics, and complicate portable type generation.

However, developers expect views to be queryable through the same DSL as tables, with full type safety and lint support. Queries should feel identical whether they target a table or a view—except that mutations are disallowed.

We need a model that:
- Keeps view definitions and metadata in packs (target-specific)
- Projects views as queryable sources so developers treat them like tables for SELECTs
- Enforces read-only semantics at runtime and via guardrails
- Supports deterministic lowering and migration operations

## Problem

- Views today are "invisible" to the query DSL; they're only accessible via raw SQL
- No way to type-check queries against views or catch mutations early
- Migration planning can't detect view changes without special logic
- Different targets (Postgres, MySQL, Mongo views) need different representations

## Decision

Treat views as **extension-owned objects** that publish **read-only sources** into the contract. Packs model and emit view metadata; core exposes them to query lanes via `contract.sources` with read-only semantics enforced by runtime and lints.

This separation allows:
- Packs to own all view-specific logic (materialization, refresh, DDL)
- Core to remain agnostic of view mechanics
- Queries to transparently reference views with type safety
- Lanes and runtime to enforce read-only constraints

## Details

### Where Views Live

**Extension objects** (pack-owned, deterministic)

Packs emit view definitions and metadata to `contract.extensionPacks.<namespace>.views[]`:

```json
{
  "extensionPacks": {
    "postgres": {
      "version": "15.0",
      "views": [
        {
          "id": "pg.view:public.active_users@sha256:abc123",
          "name": "active_users",
          "schema": "public",
          "sql": "select id, email from \"user\" where active = true",
          "shape": { "id": "int4", "email": "text" },
          "dependencies": [
            { "schema": "public", "name": "user", "kind": "table" }
          ],
          "materialized": false,
          "refreshPolicy": null
        },
        {
          "id": "pg.view:analytics.daily_stats@sha256:def456",
          "name": "daily_stats",
          "schema": "analytics",
          "sql": "select date_trunc('day', created_at) as day, count(*) as signups from \"user\" group by 1",
          "shape": { "day": "timestamptz", "signups": "int8" },
          "materialized": true,
          "refreshPolicy": { "mode": "onDemand" }
        }
      ]
    }
  }
}
```

**Read-only sources** (core aggregator, optional)

Packs may optionally project views as read-only sources under `contract.sources`:

```json
{
  "sources": {
    "public.active_users": {
      "readOnly": true,
      "projection": {
        "id": { "type": "int4", "nullable": false },
        "email": { "type": "text", "nullable": false }
      },
      "origin": {
        "namespace": "postgres",
        "kind": "view",
        "id": "pg.view:public.active_users@sha256:abc123"
      },
      "capabilities": {
        "postgres.view.base": true,
        "postgres.view.materialized": false
      }
    }
  }
}
```

### Source Structure

The `sources` map at the contract root contains all queryable sources (tables + views). Each source has:

- **`readOnly: boolean`** — If true, mutations are disallowed by lints and runtime checks
- **`projection`** — Map of column name to `{ type, nullable, ... }` for type inference
- **`origin`** (optional) — Provenance link back to the pack-owned construct: `{ namespace, kind, id }`
- **`capabilities`** — Feature flags relevant to this source (e.g., `postgres.view.materialized`, `postgres.view.refresh`)

### Type Generation for Views

When `contract.d.ts` is generated:

```typescript
export interface Sources {
  'public.active_users': {
    id: number
    email: string
  }
}

// DSL exposes sources alongside tables
export const t: TablesAndSources<Tables, Sources>
```

Developers can query views identically to tables:

```typescript
import { sql, makeT } from '@prisma/sql'

const t = makeT(contract)

const query = sql()
  .from(t['public.active_users'])  // or t.public.active_users
  .select({ id: t['public.active_users'].id, email: t['public.active_users'].email })
  .limit(100)
  .build()
```

### Mutation Disallowing

Runtime and lints prevent INSERT, UPDATE, DELETE on read-only sources:

**At build time (lints):**
- `no-mutation-on-read-only-source` (error) — Attempt to mutate a view triggers immediate DSL error
- Example: `sql().from(t.active_users).update({ /* ... */ })` fails with clear message

**At runtime (guardrails):**
- Plan verification checks `plan.refs.tables` against `contract.sources[name].readOnly`
- If any referenced table is read-only and the plan is a mutation, execution is blocked
- Error message: `"Mutations on read-only source 'public.active_users' are not allowed"`

### Materialized Views and Refresh

For materialized views, the extension object carries refresh metadata:

```json
{
  "refreshPolicy": {
    "mode": "onDemand" | "scheduled",
    "schedule": "0 * * * *",  // cron when mode = "scheduled"
    "timeout": 30000          // ms
  }
}
```

The runtime (or application code) can consult this metadata to decide when/how to refresh:

```typescript
import { getExtensionMetadata } from '@prisma/runtime/introspection'

const viewMeta = getExtensionMetadata(contract, 'postgres', 'views', 'daily_stats')
if (viewMeta.refreshPolicy?.mode === 'onDemand') {
  // Optionally refresh before querying
  await db.execute(refreshView('daily_stats'))
}
```

### Dependencies and Validation

The extension object lists dependencies (`schema.name` pairs for tables and views the view depends on):

```json
{
  "dependencies": [
    { "schema": "public", "name": "user", "kind": "table" },
    { "schema": "public", "name": "post", "kind": "table" }
  ]
}
```

**At emit time:**
- Emitter validates that all dependencies resolve to core tables or other views in `extensions.postgres.views`
- Error if a dependency is missing: `EMIT_VIEW_DEP_NOT_FOUND`

**At migration planning time:**
- Planner detects if a dependency table changes and may flag the view as needing re-creation
- Diffing and pre-checks ensure views remain consistent with their dependencies

**At preflight:**
- Preflight checks that dependent tables exist in the target database
- Fails with actionable error if a prerequisite is missing

### Migration Operations

Packs provide view-specific migration operations per ADR 116:

**Core view operations:**
- `postgres/createView` — Create a new view with DDL
- `postgres/dropView` — Drop a view with CASCADE
- `postgres/replaceView` — Replace view definition (CREATE OR REPLACE)
- `postgres/createMaterializedView` — Create a materialized view
- `postgres/dropMaterializedView` — Drop a materialized view
- `postgres/refreshMaterializedView` — Refresh a materialized view
- `postgres/setRefreshPolicy` — Update refresh schedule (if applicable)

**Pre-checks (ADR 044):**
- `viewExists(schema, name)` — Assert view currently exists
- `viewNotExists(schema, name)` — Assert view does not exist
- `viewDefinitionIs(schema, name, sql)` — Assert current definition matches expected SQL
- `viewDependenciesExist(schema, name, deps)` — Assert all dependencies exist
- `materializedViewIsFresh(schema, name)` — Assert materialized view is not stale

**Post-checks (ADR 044):**
- `viewExists` — Verify view was created
- `materializedViewExists` — Verify materialized view was created

**Idempotency:**
- `createView` with `IF NOT EXISTS` is idempotent
- `dropView` with `IF EXISTS` is idempotent
- `replaceView` with `CREATE OR REPLACE` is idempotent (if schema-compatible)
- Per ADR 038, packs must declare idempotency classification for each operation

### Capability Gating

Packs declare granular capabilities for view support:

- `postgres.view.base` — Basic view definition and querying
- `postgres.view.materialized` — Materialized view support
- `postgres.view.refresh` — Ability to refresh materialized views
- `postgres.view.withCheck` — `WITH CHECK OPTION` support
- `postgres.view.updateable` — Updatable view support (v2+, not MVP)

At emit time:
- Emitter validates that used capabilities are enabled by the adapter
- If `materialized: true` but `postgres.view.materialized` is false, emission fails

At runtime:
- Queries may branch on capabilities to decide whether to use a materialized view or fall back
- Example: preflight checks that `postgres.view.materialized` is true before including a materialized view in the bundle

### Error Taxonomy

New error codes (per ADR 027 and ADR 068):

- `EMIT_VIEW_NAME_MISSING` — View block missing name
- `EMIT_VIEW_SQL_EMPTY` — View SQL is empty
- `EMIT_VIEW_DEP_NOT_FOUND` — View dependency (table or view) not found
- `EMIT_VIEW_SHAPE_INVALID` — View shape type not a valid codec
- `EMIT_VIEW_DEP_CIRCULAR` — Circular view dependencies
- `EMIT_VIEW_MATERIALIZED_UNSUPPORTED` — Materialized views not supported on this adapter
- `EMIT_VIEW_REFRESH_UNSUPPORTED` — Refresh policy not supported
- `RUNTIME_MUTATION_ON_READ_ONLY_SOURCE` — Attempt to mutate a view
- `MIGRATION_VIEW_DEP_MISSING` — View prerequisite missing during migration

### Preflight and PPg

**Local preflight:**
- Validates that all view dependencies exist in the target database
- Checks capability support for materialized views and refresh policies
- May run `EXPLAIN` on view queries to detect performance issues

**Hosted preflight (PPg):**
- Ensures pack availability and version match
- Validates view definitions against live database
- Simulates view creation and refresh if applicable
- Reports diagnostic if view would conflict with existing schema

**Advisors:**
- PPg advisors (delivered as packs per ADR 101) can detect suboptimal views
- Example: "Materialized view 'daily_stats' not indexed; add UNIQUE on (day) to avoid full scan"

### Adapters and Lowering

When lowering a query that references a view:

1. **Consult the extension object** to get the view definition and dependencies
2. **Validate capability support** — fail if materialized views are required but not supported
3. **Render SQL** — either:
   - Inline the view name if the target supports querying views (Postgres, MySQL)
   - Expand the view definition and use as a CTE if needed for compatibility
4. **Apply optimizations** — e.g., push down predicates into view definition if safe

Example adapter hook:

```typescript
export function lowerFromClause(node: FromNode, context: LowerContext): string {
  const { table } = node

  // Check if this is a view
  const source = context.contract.sources[table]
  if (source?.origin?.kind === 'view') {
    const viewMeta = getExtensionObject(context.contract, source.origin)

    // Use view name directly (Postgres supports it)
    if (context.adapter.supports('postgres.view.base')) {
      return `"${viewMeta.schema}"."${viewMeta.name}"`
    }

    // Expand view as CTE for compatibility
    return `(${viewMeta.sql}) as "${viewMeta.name}"`
  }

  // Regular table
  return `"${context.contract.storage.tables[table].schema}"."${table}"`
}
```

### Example: Multi-Schema Views

Contract emission with views in multiple schemas:

**PSL:**
```prisma
pg.view user_summary {
  schema: "public"
  sql: """
    select user_id, count(*) as post_count
    from post group by user_id
  """
  shape: { user_id: Int, post_count: BigInt }
}

pg.view daily_signups {
  schema: "analytics"
  sql: """
    select date_trunc('day', created_at) as day, count(*) as count
    from "user" group by 1
  """
  shape: { day: DateTime, count: BigInt }
}
```

**Emitted contract:**
```json
{
  "extensionPacks": {
    "postgres": {
      "views": [
        {
          "id": "pg.view:public.user_summary@...",
          "name": "user_summary",
          "schema": "public",
          "sql": "select user_id, count(*) as post_count from post group by user_id",
          "shape": { "user_id": "int4", "post_count": "int8" },
          "materialized": false
        },
        {
          "id": "pg.view:analytics.daily_signups@...",
          "name": "daily_signups",
          "schema": "analytics",
          "sql": "select date_trunc('day', created_at) as day, count(*) as count from \"user\" group by 1",
          "shape": { "day": "timestamptz", "post_count": "int8" },
          "materialized": false
        }
      ]
    }
  },
  "sources": {
    "public.user_summary": { "readOnly": true, "projection": { "user_id": { "type": "int4" }, "post_count": { "type": "int8" } }, "origin": { "namespace": "postgres", "kind": "view", "id": "pg.view:public.user_summary@..." } },
    "analytics.daily_signups": { "readOnly": true, "projection": { "day": { "type": "timestamptz" }, "count": { "type": "int8" } }, "origin": { "namespace": "postgres", "kind": "view", "id": "pg.view:analytics.daily_signups@..." } }
  }
}
```

**Query:**
```typescript
const summary = sql()
  .from(t['public.user_summary'])
  .select({ userId: t['public.user_summary'].user_id, count: t['public.user_summary'].post_count })
  .build()
```

## Consequences

### Positive
- Views are first-class for reads without inflating core
- Consistent developer experience: querying views is identical to tables (minus mutations)
- All target-specific behaviors remain in packs and adapters
- Clear separation of extension objects (pack-owned) and read-only sources (core aggregation)
- Migration support is uniform across packs

### Negative
- Requires packs to emit view metadata in addition to core storage
- Adds optional namespace complexity (schema-qualified view names)
- Materialized view refresh semantics vary by target; packs must document trade-offs

### Trade-offs
- Views are optional; a pack can ship extension objects without projecting read-only sources if the use case is migration-only
- Read-only semantics are enforced by lints and runtime, not by database permissions (which are orthogonal)

## Scope and Non-Goals (MVP)

**In scope:**
- Base views (read-only, non-materialized)
- Querying views through the DSL with type safety
- Materialized views with optional refresh policies
- View dependencies and validation
- Migration operations for create/drop/refresh
- Basic adapters (Postgres)

**Out of scope for MVP:**
- Updatable views (v2+)
- View partitioning and sharding
- Cross-database view references
- Automatic view maintenance and statistics
- Advanced refresh strategies (incremental, partial)

## Open Questions

- Should views be allowed in `contract.sources` but not necessarily exposed by packs (e.g., internal views)?
- How do we represent view column provenance for advanced advisors that need to trace columns back to base tables?
- Should we support cross-namespace view dependencies (one pack's view depending on another pack's table)?
- How do refresh policies interact with preflight shadow databases and transaction semantics?

## References

- **ADR 038** — Operation idempotency classification & enforcement
- **ADR 044** — Pre & post check vocabulary v1
- **ADR 101** — Advisors Framework
- **ADR 105** — Contract extension encoding
- **ADR 116** — Extension-aware migration ops
- **ADR 117** — Extension capability keys
- **ADR 126** — PSL top-level block SPI
- **Doc 1** — Data Contract
- **Doc 3** — Query Lanes
- **Doc 5** — Migration System
- **Doc 12** — Ecosystem Extensions & Packs
