# Data Migrations Plan

## Summary

Data migration support for prisma-next's graph-based migration system. All migrations (structural + data) are authored as TypeScript operation chains using `createBuilders<Contract>()`, serialized to SQL at verification time, and executed at apply time. Data transforms are first-class operations with typed query builder callbacks.

**Spec:** `projects/graph-based-migrations/specs/data-migrations-spec.md`

## Prerequisites

- [x] Refs refactored to per-file directory model with invariants
- [x] Phantom `@prisma-next/cli` dependencies removed from target-postgres, adapter-postgres, extension-pgvector, family-sql
- [x] sql-builder integration tests moved to integration test package (breaks cycle, enables target-postgres → sql-builder dependency)

## Milestone 1: Descriptor-based planner

- [x] Operation descriptors, resolver, migration strategy pipeline
- [x] migration.ts scaffolded with real builder calls
- [x] Plan → evaluate → resolve → ops.json → attest round-trip
- [x] New tables emit FK, index, unique, enum, dependency descriptors
- [x] Old planner fallback removed from `migration plan`
- [x] Verifier path for types/deps in contract-to-contract planning
- [x] Enum value add/remove/reorder support via primitive descriptors and rebuild recipe
- [x] `SchemaIssue` discriminated union: `BaseSchemaIssue | EnumValuesChangedIssue`
- [x] `contractToSchemaIR` re-keys storage types by nativeType for correct verifier hook resolution
- [x] Structural descriptors moved to `@prisma-next/family-sql/operation-descriptors` (shared across SQL targets)
- [x] New primitives: `addEnumValues`, `dropEnumType`, `renameType`, `alterColumnType` with `using`/`toType`
- [ ] Descriptor ordering — drops after pattern ops for column split (1 failing test)
- [ ] Transaction descriptors — `transaction([...ops])` and `noTransaction(op)` per spec R6
- [ ] `ALTER TYPE ADD VALUE` requires `noTransaction` — blocked on R6
- [ ] Delete old planner once `db update` migrated

## Milestone 2: Data migration detection

- [x] NOT NULL backfill strategy — addColumn(nullable) + dataTransform + setNotNull
- [x] Unsafe type change strategy — safe widenings → alterColumnType, unsafe → dataTransform
- [x] Nullable tightening strategy — nullable → NOT NULL → dataTransform + setNotNull
- [x] Enum change strategy — add-only → addEnumValues, removal → dataTransform + rebuild recipe, reorder → rebuild recipe
- [x] Scenario test suite (48 tests, 2 known failures as gap map)
- [x] Strategies extracted to `planner-strategies.ts`, pluggable via `planDescriptors({ strategies })` 
- [ ] Dev push strategies for `db update` (temp defaults, destructive type changes, no data transforms)
- [ ] Unknown codec type detection (test 27 — verifier doesn't flag types with no codec hooks)

## Milestone 3: Unified TS authoring

- [x] migration.ts scaffold/evaluate utilities
- [x] `migration new` command
- [x] `migration verify` re-evaluates migration.ts on every run
- [x] Runner data transform lifecycle (check → run → check)
- [x] Query builder integration via typed callbacks: `(db) => db.user.update(...)`
- [x] `createBuilders<Contract>()` for typed dataTransform callbacks with full autocomplete
- [x] SQL lowered at verify time via postgres adapter, stored in ops.json as `{ sql, params }`
- [x] `queryOperations` on control descriptors for extension function support (e.g., pgvector cosineDistance)
- [x] Scaffold generates `createBuilders<Contract>()` with contract type import when data transforms detected
- [x] Multi-statement data transforms: `(db) => [insert, update]` from single callback
- [x] Scaffold serializes `createEnumType` values, `alterColumnType` using/toType, `dropEnumType`, `renameType`

## Milestone 4: CLI polish

- [x] Draft migration visibility (status/apply/plan + dashed graph edges)
- [ ] migration show for data transforms
- [ ] Verify hardening (error cases, output display)
- [ ] Stale directory cleanup on plan failure — when the non-draft path (evaluate → resolve → write ops → attest) fails after `writeMigrationPackage` + `scaffoldMigrationTs`, a partial package is left on disk. Either write to a temp dir and rename on success, or clean up in the catch block.

## Milestone 5: Graph integration

- [ ] Migration edges carry data transform metadata
- [ ] Invariant-aware path selection from environment refs
- [ ] Ledger records data transform names

## E2E verified scenarios

Tested against real Postgres database with data:
- [x] Initial creation with enum type + data insert
- [x] Enum value removal with data transform (moderator → user) + rebuild recipe
- [x] Enum value reorder (admin,user → user,admin) + rebuild recipe
- [x] Enum value rename (user → member) via USING clause in alterColumnType
- [ ] Enum value addition — blocked on `noTransaction` runner support (ALTER TYPE ADD VALUE can't run in a transaction)

## Open Items

1. **Query builder expressiveness**: UPDATE SET column = other_column (column references in SET) not supported. INSERT...SELECT, subqueries with joins also gaps. The SQL builder AST is DML-focused and lacks DDL-oriented nodes (CASE expressions, type casts). Enum USING clauses require raw SQL strings. Tracked in spec.

2. **Stale serialization**: If migration.ts is edited after verify, ops.json is stale. Re-running verify re-evaluates. No mtime-based detection.

3. **Editing already-applied migrations**: `migration verify` re-attests silently even if the migration was already applied. Filed in issue-triage.md.

4. **`db update` migration path**: `db update` and `db init` use the old reconciliation planner. Needs dev-push strategies (temp defaults, destructive type changes, no data transforms) before the old planner can be deleted. Only 2 production call sites: `db-update.ts` and `db-init.ts`.

5. **Enum value rename UX**: Removal + addition can't be automatically distinguished from a rename. The scaffold generates a rebuild recipe with TODO in the USING clause — user must provide the value mapping manually (same pattern as column renames).

6. **Enum rebuild fails if column has a default**: `ALTER COLUMN TYPE` fails when a default expression is bound to the old enum type. The rebuild recipe must drop defaults before the type change and recreate them after the rename.

7. **Legacy MigrationBundle/MigrationPackage aliases**: `exports/types.ts` re-exports `BaseMigrationBundle` as `MigrationBundle` and `MigrationPackage` for backwards compat. One consumer (`migration-show.ts`) still uses `MigrationBundle`. Should be migrated to canonical types.

8. **Draft-only repos show "No migrations found"**: When `attested.length === 0` but drafts exist, `migration status` returns early with no graph — draft edges aren't visualized. The diagnostic warns about drafts but the graph isn't rendered.

9. **Chained draft edges dropped in graph rendering**: In `graph-migration-mapper.ts`, when a draft's `from` hash references another draft (not in `graph.nodes`), the dashed edge is silently dropped. Fix: traverse `input.draftEdges` chain to find an attested ancestor, or materialize intermediate draft nodes/edges.
