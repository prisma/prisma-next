# @prisma-next/contract-authoring

**Status:** Phase 2 - Target-agnostic contract authoring core extracted

This package contains the target-agnostic contract authoring builder core for Prisma Next.

## Overview

This package provides generic builder primitives that can be composed with target-family specific types (e.g., SQL) to create contract authoring surfaces. It is part of the authoring ring and depends only on `@prisma-next/contract` and core packages.

## Package Status

This package was created in Phase 2 of the contract authoring extraction. It contains the extracted target-neutral builder core from `@prisma-next/sql-contract-ts`. The SQL layer (`@prisma-next/sql-contract-ts`) composes this generic core with SQL-specific types.

## Architecture

- **Builder state types**: Generic state types (`ColumnBuilderState`, `TableBuilderState`, `ModelBuilderState`, `ContractBuilderState`) that don't reference any target-family specific types
- **Builder classes**: Generic builder classes (`TableBuilder`, `ModelBuilder`, `ContractBuilder`) that handle state management
- **Type helpers**: Generic type-level helpers for transforming builder states into contract structures
- **No target-specific logic**: This package must remain target-family agnostic and cannot import from `@prisma-next/sql-*` or other family-specific modules

## Dependencies

- `@prisma-next/contract` - Core contract types
- `ts-toolbelt` - Type utilities

## Exports

- Builder state types: `ColumnBuilderState`, `TableBuilderState`, `ModelBuilderState`, `ContractBuilderState`, `RelationDefinition`, `ColumnBuilder`
- Builder classes: `TableBuilder`, `ModelBuilder`, `ContractBuilder`
- Type helpers: `BuildStorageColumn`, `BuildStorage`, `BuildModels`, `BuildRelations`, extract helpers, `Mutable`
- Factory function: `defineContract()` (generic)

## Usage

This package is intended for use by target-family specific authoring packages (e.g., `@prisma-next/sql-contract-ts`). End users should import from the target-family specific packages, not directly from this package.

## See Also

- `@prisma-next/sql-contract-ts` - SQL-specific contract authoring surface that composes this generic core
