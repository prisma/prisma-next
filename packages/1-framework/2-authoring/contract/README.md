# @prisma-next/contract-authoring

**Status:** Shared authoring state/types for target-specific contract DSLs

This package contains the target-agnostic authoring state and descriptor types shared by Prisma Next contract authoring packages.

## Overview

This package provides the shared state shapes and descriptor types used by target-family specific contract authoring packages. It is part of the authoring ring and depends only on `@prisma-next/contract` and core packages.

## Responsibilities

- **Authoring State Types**: Defines target-agnostic state shapes for columns, tables, models, relations, storage types, and contract metadata
- **Storage Type State**: Captures target-agnostic storage type entries and column `typeRef` metadata for family-specific composition
- **Descriptor Types**: Provides shared descriptor contracts such as `ColumnTypeDescriptor`, `IndexDef`, and foreign-key metadata
- **Composition Surface**: Enables target-family specific packages (e.g., `@prisma-next/sql-contract-ts`) to share common authoring data structures
- **Defaults**: Reuses shared contract `ColumnDefault` for db-agnostic defaults (literal, function, and client-generated descriptors)
- **Foreign Keys Configuration**: Defines the shared `ForeignKeyDefaultsState` used by authoring surfaces that materialize FK defaults

## Package Status

This package was created during the contract authoring extraction. It now exists only to share target-neutral authoring state and descriptor types. The SQL layer (`@prisma-next/sql-contract-ts`) consumes these types for lowering and validation.

## Architecture

- **Builder state types**: Generic state types (`ColumnBuilderState`, `TableBuilderState`, `ModelBuilderState`, `ContractBuilderState`) that don't reference any target-family specific types
- **Descriptor types**: Shared descriptor contracts (`ColumnTypeDescriptor`, `IndexDef`, `ForeignKeyDef`) used by authoring packages, targets, and extensions
- **No target-specific logic**: This package must remain target-family agnostic and cannot import from `@prisma-next/sql-*` or other family-specific modules

## Dependencies

- `@prisma-next/contract` - Core contract types
- `ts-toolbelt` - Type utilities

## Exports

- Authoring state types: `ColumnBuilderState`, `TableBuilderState`, `ModelBuilderState`, `ContractBuilderState`, `ForeignKeyDefaultsState`, `RelationDefinition`
- Shared descriptor types: `ColumnTypeDescriptor`, `IndexDef`, `ForeignKeyDef`, `ForeignKeyOptions`, `UniqueConstraintDef`

## Usage

This package is intended for use by target-family specific authoring packages (e.g., `@prisma-next/sql-contract-ts`) and by target/extension packages that need shared authoring descriptor types. End users should import from the target-family specific packages, not directly from this package.

## See Also

- `@prisma-next/sql-contract-ts` - SQL-specific contract authoring surface that composes this generic core
