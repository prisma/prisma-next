---
date: 2026-02-25
topic: sql-lowering
status: resolved
---

# SQL Lowering: Drop Abstract Ops, Write SQL to Disk

## What We Built

Changed the migration planner to produce `SqlMigrationPlanOperation` directly instead of `AbstractOp`. Dropped the abstract ops layer entirely. `ops.json` on disk is serialized `SqlMigrationPlanOperation[]` — the same type the existing runner already consumes. `migration apply` will read and execute the SQL without any resolver.

## Why This Approach

Abstract ops added an indirection layer (structured IR that needs resolution to SQL at apply time) without practical benefit. Migrations are written for a specific database — if you change targets, you'd start fresh. Lowering to SQL at plan time is simpler, eliminates the need for a resolver, and makes apply trivial.

The existing `SqlMigrationPlanOperation` type is battle-tested (used by the introspection-based planner and runner). Reusing it means no new on-disk format to design and the runner can consume migration files directly.

## Key Decisions

- **On-disk ops format**: `SqlMigrationPlanOperation<PostgresPlanTargetDetails>[]` serialized as JSON. Same type the runner already uses.
- **Layering**: `migration-tools` (framework domain) cannot import from sql domain. It types ops as `MigrationPlanOperation[]` — the base interface already in `@prisma-next/core-control-plane`. The full `SqlMigrationPlanOperation` shape is on disk in JSON, but framework code only sees the base fields (`id`, `label`, `operationClass`). The sql/target layer widens to the full type when reading ops for execution.
- **Abstract ops removal**: Deleted `AbstractOp`, `AbstractCheck`, `AbstractColumnDefinition`, etc. No intermediate IR — the planner produces SQL directly.
- **No separate diff types**: `migration plan` uses the same `planner.plan()` path as `db init`. The `ContractDiffResult` / `planContractDiff` abstraction was removed — it was a redundant wrapper over the existing planner. Instead, `TargetMigrationsCapability` exposes `contractToSchema()` and `detectDestructiveChanges()` for offline planning.
- **Pre/post checks**: Move from structured `AbstractCheck` predicates to resolved SQL in `precheck`/`postcheck` steps (as `SqlMigrationPlanOperationStep`). The ADR 044 vocabulary still defines the *semantics*, but the on-disk format carries the resolved SQL, not the structured predicates. This matches what the existing planner already produces.
- **`EMPTY_CONTRACT_HASH`**: Stays in framework domain. Not affected by this change.

## Resolved Questions

- **Planner interface for offline planning**: `migration plan` calls `TargetMigrationsCapability.contractToSchema(fromContract)` to synthesize a schema IR, then `migrations.createPlanner(family).plan(...)` — the same code path as `db init`. No separate entry point needed.
- **Existing planner tests**: Tests were adapted to use `planFromStorages()` helper (which calls `contractToSchemaIR` + `planner.plan()` directly) and `detectDestructiveChanges()` for destructive scenarios. No tests needed rewriting from scratch.
