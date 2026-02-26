---
date: 2026-02-25
topic: sql-lowering
---

# SQL Lowering: Drop Abstract Ops, Write SQL to Disk

## What We're Building

Change the contract-to-contract planner to produce `SqlMigrationPlanOperation` directly instead of `AbstractOp`. Drop the abstract ops layer entirely. `ops.json` on disk becomes serialized `SqlMigrationPlanOperation[]` — the same type the existing runner already consumes. `migration apply` reads and executes the SQL without any resolver.

## Why This Approach

Abstract ops added an indirection layer (structured IR that needs resolution to SQL at apply time) without practical benefit. Migrations are written for a specific database — if you change targets, you'd start fresh. Lowering to SQL at plan time is simpler, eliminates the need for a resolver, and makes apply trivial.

The existing `SqlMigrationPlanOperation` type is battle-tested (used by the introspection-based planner and runner). Reusing it means no new on-disk format to design and the runner can consume migration files directly.

## Key Decisions

- **On-disk ops format**: `SqlMigrationPlanOperation<PostgresPlanTargetDetails>[]` serialized as JSON. Same type the runner already uses.
- **Layering**: `migration-tools` (framework domain) cannot import from sql domain. It types ops as `MigrationPlanOperation[]` — the base interface already in `@prisma-next/core-control-plane`. The full `SqlMigrationPlanOperation` shape is on disk in JSON, but framework code only sees the base fields (`id`, `label`, `operationClass`). The sql/target layer widens to the full type when reading ops for execution.
- **Abstract ops removal**: Delete `abstract-ops.ts` types (`AbstractOp`, `AbstractCheck`, `AbstractColumnDefinition`, etc.) and `ContractDiffResult`. Replace `ContractDiffResult` with a result type that carries `SqlMigrationPlanOperation[]` instead.
- **Pre/post checks**: Move from structured `AbstractCheck` predicates to resolved SQL in `precheck`/`postcheck` steps (as `SqlMigrationPlanOperationStep`). The ADR 044 vocabulary still defines the *semantics*, but the on-disk format carries the resolved SQL, not the structured predicates. This matches what the existing planner already produces.
- **`EMPTY_CONTRACT_HASH`**: Stays in framework domain. Not affected by this change.

## Open Questions

- Exact signature change for `planContractDiff` — needs to return `SqlMigrationPlanOperation[]` (or a result wrapper for the conflict case) instead of `ContractDiffResult`.
- How much of the existing planner tests need rewriting vs adapting (they currently assert on `AbstractOp` shapes).

## Next Steps

Detailed task plan written: `projects/on-disk-migrations/plans/m4-sql-lowering.plan.md`
