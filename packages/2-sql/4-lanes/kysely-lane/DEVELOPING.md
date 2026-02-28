# Developing `@prisma-next/sql-kysely-lane`

This document is for contributors working on the Kysely lane implementation.
For user-facing guidance and examples, see [`README.md`](./README.md).

## Overview

This package provides the build-only logic for the Kysely lane: transforming Kysely compiled query AST into Prisma Next SQL `QueryAst`, running pre-transform guardrails, assembling build-only `SqlQueryPlan` metadata, and exposing the lane-owned build-only Kysely client surface consumed by `@prisma-next/postgres`. It does not depend on `@prisma-next/sql-runtime`.

## Responsibilities

- **Transform**: Convert Kysely `compiledQuery` AST (SelectQueryNode, InsertQueryNode, UpdateQueryNode, DeleteQueryNode) into PN SQL AST (`QueryAst`)
- **Guardrails**: Pre-transform validation for multi-table scope (qualified refs, unambiguous selectAll)
- **Plan assembly**: Build `SqlQueryPlan` with stable refs/param descriptors and redacted SQL annotation metadata
- **Lane client surface**: Build-only Kysely lane (`build`, `whereExpr`, `redactedSql`) plus execution backstop dialect plumbing
- **Error codes**: Stable `KyselyTransformError` with codes for unsupported nodes, invalid refs, and contract validation

## Dependencies

- `@prisma-next/contract` — PlanRefs, ParamDescriptor
- `@prisma-next/sql-contract` — SqlContract, SqlStorage
- `@prisma-next/sql-relational-core` — AST types (SelectAst, InsertAst, etc.)
- `@prisma-next/utils` — ifDefined

## Exports

- `transformKyselyToPnAst(contract, query, parameters)` — Main transform entry point
- `runGuardrails(contract, query)` — Pre-transform validation for SelectQueryNode
- `buildKyselyPlan(contract, compiledQuery)` — Build-only plan assembly entry point
- `buildKyselyWhereExpr(contract, compiledQuery)` — Kysely-authored filter interop helper producing `ToWhereExpr`
- `createKyselyLane(contract)` — Lane-owned Kysely surface factory for composition roots
- `REDACTED_SQL` — Canonical SQL redaction marker used by the lane
- `KyselyTransformError`, `KYSELY_TRANSFORM_ERROR_CODES` — Error types
- `TransformResult` — Result type (ast + metaAdditions)

## Architecture

```mermaid
flowchart LR
  Kysely[Kysely compiledQuery] --> Build[buildKyselyPlan]
  Build --> Guardrails[runGuardrails]
  Build --> Transform[transformKyselyToPnAst]
  Transform --> AST[QueryAst]
  Build --> Plan[SqlQueryPlan + meta annotations]
  AST --> Plan
  Plan --> Consumer[@prisma-next/postgres or build-only callers]
```

The lane package is build-only: it produces AST and plan metadata. SQL lowering and physical execution live in runtime packages.

## Related Packages

- `@prisma-next/postgres` — Exposes build-only `db.kysely` and delegates plan assembly to this lane
- `@prisma-next/sql-relational-core` — Provides AST types used by the transformer

## Related Subsystems

- [Query Lanes](/docs/architecture%20docs/subsystems/3.%20Query%20Lanes.md)
- [ADR 160 - Kysely lane emits PN SQL AST](/docs/architecture%20docs/adrs/ADR%20160%20-%20Kysely%20lane%20emits%20PN%20SQL%20AST.md)

