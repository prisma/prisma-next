# @prisma-next/sql-orm-lane

ORM builder, include compilation, and relation filters for Prisma Next.

## Overview

This package provides the ORM query builder that compiles model-based queries to SQL lane primitives. It is part of the SQL lanes ring and depends on `@prisma-next/sql-relational-core` for schema access and `@prisma-next/sql-lane` for query building.

## Responsibilities

- **ORM query builder**: Model-based query builder (`orm()`)
- **Include compilation**: ORM includes compile to SQL lane primitives like `includeMany`
- **Relation filters**: Filter queries by related model properties (`some`, `none`, `every`)
- **Model accessors**: Type-safe access to models and their columns/relations

## Dependencies

- `@prisma-next/contract` - Contract types and plan metadata
- `@prisma-next/plan` - Plan helpers and error utilities
- `@prisma-next/runtime` - Runtime context for adapter access
- `@prisma-next/sql-lane` - Relational DSL for query building
- `@prisma-next/sql-relational-core` - Schema and column builders
- `@prisma-next/sql-target` - SQL contract types and AST definitions

## Exports

- `./orm` - ORM builder entry point (`orm()`, `OrmRegistry`, `OrmModelBuilder`, etc.)

## Architecture

This package compiles ORM queries to SQL lane primitives (AST nodes). Dialect-specific lowering to SQL strings happens in adapters (per ADR 015 and ADR 016).

The ORM builder:
1. Takes model-based queries (e.g., `orm().user().where(...).include(...)`)
2. Compiles them to SQL lane primitives (e.g., `sql().from(...).where(...).includeMany(...)`)
3. Returns plans that can be executed by the runtime

## Related Packages

- `@prisma-next/sql-relational-core` - Provides schema and column builders used by this package
- `@prisma-next/sql-lane` - Relational DSL that this package compiles to
- `@prisma-next/sql-target` - Defines SQL contract types and AST structures
