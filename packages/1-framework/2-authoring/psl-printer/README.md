# @prisma-next/psl-printer

Prints Prisma Schema Language (PSL) from introspected SQL schema IR.

## Overview

`@prisma-next/psl-printer` converts `SqlSchemaIR` into deterministic PSL text for brownfield authoring and database introspection flows. It is intentionally printer-only: database inspection, semantic verification, and contract emission stay in adjacent packages.

## Responsibilities

- Convert `SqlSchemaIR` tables, relations, enums, defaults, and indexes into valid PSL output.
- Normalize database names into stable PSL identifiers while preserving original names with `@map` and `@@map`.
- Preserve storage-level defaults when PSL client-side defaults would change semantics.
- Generate deterministic output so round-tripping and snapshot-based tests remain stable.
- Surface unsupported types and raw defaults in a way that keeps the emitted PSL readable.

## Dependencies

- **Depends on**
  - `@prisma-next/contract`
  - `@prisma-next/sql-schema-ir`
  - `@prisma-next/utils`
- **Used by**
  - `@prisma-next/cli` for `db introspect`
  - future authoring and emit flows that need PSL output from SQL schema IR

## Related Docs

- `docs/Architecture Overview.md`
- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
