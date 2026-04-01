# Proposal: Descriptor-Based Planner Replacement

## Context

The current Postgres planner produces `SqlMigrationPlanOperation[]` directly — assembling SQL, prechecks, postchecks, and target details inline. It has significant complexity around the temporary default strategy (a workaround for adding NOT NULL columns without data migrations). With data migrations now supported, this workaround is unnecessary — the planner can emit `addColumn` (nullable) + `dataTransformDraft` + `setNotNull` instead.

The operation resolver already exists and can convert descriptors into `SqlMigrationPlanOperation[]` using the same SQL helpers the planner uses. This proposal replaces the planner's SQL generation with descriptor emission, unifying the code path for planner-generated and user-authored migrations.

## Prerequisites

### Augment SchemaIssue with missing constraint kinds

The verifier (`verifySqlSchema`) currently reports `missing_table` and `missing_column` but not missing constraints, indexes, or FKs. The planner's additive builders detect these by iterating the contract against the schema — duplicating the verifier's job.

**Add these issue kinds to SchemaIssue:**

| New issue kind | When it fires | Fields needed |
|---|---|---|
| `missing_primary_key` | Contract table has PK, schema table doesn't | `table`, `expected` (column list) |
| `missing_unique_constraint` | Contract has unique, schema doesn't (checked via column set matching, including unique indexes) | `table`, `indexOrConstraint` (name), `expected` (columns) |
| `missing_foreign_key` | Contract has FK with `constraint: true`, schema doesn't | `table`, `indexOrConstraint` (name), `expected` (columns + references) |
| `missing_index` | Contract has index, schema doesn't (checked via column set matching) | `table`, `indexOrConstraint` (name), `expected` (columns) |
| `missing_fk_backing_index` | FK has `index: true`, no matching user-declared or existing index | `table`, `indexOrConstraint` (generated name), `expected` (FK columns) |

**Where to implement:** `packages/2-sql/3-tooling/family/src/core/schema-verify/verify-sql-schema.ts`

**Impact:** The verifier is used by `db verify`, `migration plan`, and `db update`. Adding missing-constraint detection is additive — existing consumers see more issues but don't break (they already handle unknown issue kinds gracefully).

## The replacement planner

### Input
Same as today: destination contract + source schema IR + policy + framework components

### Output
`MigrationOpDescriptor[]` instead of `SqlMigrationPlanOperation[]`

### Flow

```
1. Extract codec hooks (once)
2. Collect schema issues (verifySqlSchema — now with missing constraint kinds)
3. Build pre-computed schema lookups (for dedup — same as today)
4. Iterate issues in dependency order, emit descriptors:

   For each issue:
     missing_table       → createTable(tableName)
     missing_column      → addColumn(tableName, columnName)
                            + if NOT NULL without default:
                              addColumn(tableName, columnName, { nullable: true })
                              + dataTransformDraft(name, source)
                              + setNotNull(tableName, columnName)
     missing_primary_key → addPrimaryKey(tableName)
     missing_unique      → addUnique(tableName, columns)
     missing_index       → createIndex(tableName, columns)
     missing_fk_index    → createIndex(tableName, fkColumns)
     missing_foreign_key → addForeignKey(tableName, columns)
     extra_table         → dropTable(tableName)          [if destructive allowed]
     extra_column        → dropColumn(tableName, colName) [if destructive allowed]
     extra_index         → dropIndex(tableName, indexName) [if destructive allowed]
     extra_unique        → dropConstraint(tableName, name) [if destructive allowed]
     extra_foreign_key   → dropConstraint(tableName, name) [if destructive allowed]
     extra_primary_key   → dropConstraint(tableName, name) [if destructive allowed]
     nullability_mismatch (→NOT NULL) → setNotNull(tableName, colName) [destructive]
     nullability_mismatch (→nullable) → dropNotNull(tableName, colName) [widening]
     type_mismatch       → alterColumnType(tableName, colName) [destructive]
     default_missing     → setDefault(tableName, colName) [additive]
     default_mismatch    → setDefault(tableName, colName) [widening]
     extra_default       → dropDefault(tableName, colName) [destructive]

5. Handle database dependencies (extensions) — emit descriptors or pass through as-is
6. Handle storage types (codec hooks) — emit descriptors or pass through as-is
7. Filter by policy, convert disallowed ops to conflicts
8. Return descriptors (or resolve immediately if backward compat needed)
```

### Ordering

The current planner uses strict ordering: deps → types → reconciliation → tables → columns → PK → unique → index → FK-index → FK. This is a dependency order.

The descriptor-based planner preserves this by emitting descriptors in the same order. The issue iteration can be sorted into this order by kind:

```
1. dependency_missing
2. type_missing / type_values_mismatch
3. extra_* (reconciliation drops — before creates to avoid name conflicts)
4. missing_table
5. missing_column
6. nullability_mismatch, type_mismatch, default_* (reconciliation alters)
7. missing_primary_key
8. missing_unique_constraint
9. missing_index
10. missing_fk_backing_index
11. missing_foreign_key
```

This is the same ordering the current planner achieves through its multi-pass pipeline, just expressed as a sort on issue kinds.

### What gets removed

| Current planner code | Reason for removal |
|---|---|
| `buildTableOperations` | Replaced by `missing_table` issue → `createTable` descriptor |
| `buildColumnOperations` | Replaced by `missing_column` issue → `addColumn` descriptor |
| `buildAddColumnOperation` | Replaced by descriptor emission |
| `buildPrimaryKeyOperations` | Replaced by `missing_primary_key` issue → `addPrimaryKey` descriptor |
| `buildUniqueOperations` | Replaced by `missing_unique` issue → `addUnique` descriptor |
| `buildIndexOperations` | Replaced by `missing_index` issue → `createIndex` descriptor |
| `buildFkBackingIndexOperations` | Replaced by `missing_fk_backing_index` issue → `createIndex` descriptor |
| `buildForeignKeyOperations` | Replaced by `missing_foreign_key` issue → `addForeignKey` descriptor |
| `canUseSharedTemporaryDefaultStrategy` | Unnecessary — data migrations replace temp defaults |
| `resolveIdentityValue` / identity value maps | Unnecessary — data migrations replace temp defaults |
| `buildAddNotNullColumnWithTemporaryDefaultOperation` (recipe) | Unnecessary — replaced by addColumn(nullable) + dataTransform + setNotNull |
| All inline SQL generation in builder methods | Moved to resolver (already exists) |

### What gets preserved

| Code | Why preserved |
|---|---|
| Schema lookup pre-computation (`buildSchemaLookupMap`) | Still needed by verifier for constraint dedup |
| Policy enforcement / conflict generation | Same logic, just operates on descriptors instead of ops |
| Codec hook delegation (`buildStorageTypeOperations`) | Hooks already produce operations; can pass through or wrap |
| `buildDatabaseDependencyOperations` | Extensions produce their own ops; can pass through or wrap |
| Operation deduplication by ID | Same pattern, applied to descriptors |
| `sortedEntries` for deterministic ordering | Still needed for reproducible plans |

### What the resolver needs to handle (new)

The resolver already handles all the additive descriptors. For the reconciliation descriptors, it needs:

| Descriptor | Resolver work | Already implemented? |
|---|---|---|
| `dropTable` | Generate DROP TABLE + checks | Yes |
| `dropColumn` | Generate ALTER TABLE DROP COLUMN + checks | Yes |
| `dropConstraint` | Generate ALTER TABLE DROP CONSTRAINT + checks | Yes |
| `dropIndex` | Generate DROP INDEX + checks | Yes |
| `alterColumnType` | Generate ALTER COLUMN TYPE + USING + warning | Yes |
| `setNotNull` | Generate ALTER COLUMN SET NOT NULL + NULL check | Yes |
| `dropNotNull` | Generate ALTER COLUMN DROP NOT NULL | Yes |
| `setDefault` | Generate ALTER COLUMN SET DEFAULT (from contract) | Yes |
| `dropDefault` | Generate ALTER COLUMN DROP DEFAULT | Yes |

All reconciliation operations are already handled by the resolver.

## Data migration detection

With the descriptor-based planner, detection is natural:

```typescript
case 'missing_column':
  const column = contract.storage.tables[issue.table].columns[issue.column];
  if (column.nullable === false && column.default === undefined) {
    // NOT NULL without default → needs data migration
    descriptors.push(addColumn(issue.table, issue.column, { nullable: true }));
    descriptors.push(dataTransformDraft(`backfill-${issue.table}-${issue.column}`, 'migration.ts'));
    descriptors.push(setNotNull(issue.table, issue.column));
  } else {
    descriptors.push(addColumn(issue.table, issue.column));
  }
  break;
```

No interception of private methods. No post-processing of ops. The pattern matching happens where it naturally belongs — in the issue-to-descriptor mapping.

## Migration output

The planner currently writes `ops.json` directly (via `writeMigrationPackage`). With the descriptor-based planner:

**Option A — Resolve immediately:** Planner emits descriptors → resolver converts to ops → write ops.json. Same output as today. Backward compatible. The planner is internally descriptor-based but externally produces ops.

**Option B — Write descriptors + migration.ts:** Planner emits descriptors → write them as a `migration.ts` file (the descriptors ARE the builder calls) → ops.json stays empty (draft) → user runs verify to resolve. This is the full TS-authoring model.

**Recommendation:** Option A for v1 (backward compat, no workflow change), with Option B as a flag or future default. The planner returns descriptors internally; the caller decides whether to resolve immediately or scaffold migration.ts.

## Implementation plan

1. **Augment SchemaIssue** with missing constraint kinds in verifier (~200 lines)
2. **Write the descriptor-based planner** as a new method alongside the existing one (~300 lines)
3. **Wire it in** behind a flag or as a replacement
4. **Add data migration detection** in the missing_column handler
5. **Remove temp default code** (canUseSharedTemporaryDefaultStrategy, resolveIdentityValue, recipe)
6. **Tests:** Run existing planner integration tests against the new planner, verify same ops output

## Risks

- **Verifier changes** affect `db verify` — must ensure new issue kinds don't cause false positives in existing verify workflows
- **Operation ordering** must be exactly preserved — any reordering could break FK dependencies
- **createTable** currently inlines all columns + PK in one DDL statement. If we emit per-column descriptors for new tables, the SQL output changes (CREATE TABLE with no columns, then ALTER TABLE ADD COLUMN for each). This may be undesirable — keeping `createTable` as a single descriptor that the resolver handles as one DDL statement is better.
- **Codec hook operations** currently produce `SqlMigrationPlanOperation` directly. The descriptor-based planner would need to either pass these through or define a descriptor for them.
