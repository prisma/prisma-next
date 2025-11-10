# @prisma-next/sql-lane

Relational DSL and raw SQL helpers for Prisma Next.

## Overview

This package provides the relational query DSL and raw SQL helpers for building SQL queries. It is part of the SQL lanes ring and depends on `@prisma-next/sql-relational-core` for schema and column builders.

## Responsibilities

- **Relational DSL**: Fluent query builder for SELECT, INSERT, UPDATE, DELETE queries
- **Raw SQL helpers**: Template literal and function-based raw SQL query builders
- **Query building**: AST construction and plan generation for SQL queries
- **Join support**: Inner, left, right, and full joins
- **Include support**: `includeMany` for nested queries using lateral joins and JSON aggregation

## Dependencies

- `@prisma-next/contract` - Contract types and plan metadata
- `@prisma-next/plan` - Plan helpers and error utilities
- `@prisma-next/sql-relational-core` - Schema and column builders
- `@prisma-next/sql-target` - SQL contract types and AST definitions

## Exports

- `.` - Main package export (exports `sql`, `SelectBuilder`, `rawOptions`, and types)
- `./sql` - Relational DSL entry point (`sql()`, `SelectBuilder`, `InsertBuilder`, `UpdateBuilder`, `DeleteBuilder`)

## Architecture

This package compiles relational DSL queries to SQL AST nodes. Dialect-specific lowering to SQL strings happens in adapters (per ADR 015 and ADR 016).

## Related Packages

- `@prisma-next/sql-relational-core` - Provides schema and column builders used by this package
- `@prisma-next/sql-orm-lane` - ORM builder that compiles to this package's DSL primitives
- `@prisma-next/sql-target` - Defines SQL contract types and AST structures
