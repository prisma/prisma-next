# Prisma Schema Parity and Gaps

## Scope

This document tracks `.prisma` feature support in Prisma Next for:

- Contract emission (`contract emit` from `.prisma`)
- Schema apply parity (`db push`)
- Database introspection parity (`db pull`)

## Current Status

### Fully covered paths

- Prisma PSL parsing compatibility: delegated to Prisma 7 parser/CLI.
- Database schema application parity: delegated to Prisma 7 `db push`.
- Database introspection formatting parity: delegated to Prisma 7 `db pull --print`.

### Contract conversion (partial/lossy areas)

The conversion layer currently emits warnings in `contract.meta.prismaPsl.missingFeatures` for cases where contract IR is not lossless:

- Referential action metadata on FKs (`onDelete`, `onUpdate`) is not preserved in contract FK objects.
- Advanced index options are not fully represented:
  - per-column sort direction
  - operator classes
  - index algorithms
  - length modifiers
- Fulltext index semantics are downgraded to regular index representation.
- Multi-schema placement and datasource schema metadata are not preserved.
- View blocks are not represented in SQL storage output.
- Composite types and unsupported scalar declarations are not fully represented.
- Some generator/client-driven behaviors (for example `@updatedAt`) are represented as feature notes rather than storage defaults.

### Migration-system implications

Current Prisma Next migration operations cannot yet recreate every structure that Prisma can create via `db push`. Notable examples:

- Advanced index variants/options listed above.
- Structures requiring richer contract metadata than current storage schema exposes.
- Feature classes currently tracked as missing by converter metadata.

Where unsupported, the system reports gaps instead of silently claiming parity.

### Real-World Fixture Coverage

The converter is tested on complex schemas sourced from Prisma example projects, including:

- `inbox-zero` schema
- `nextcrm` schema

These fixtures validate broad parser/converter compatibility and ensure missing-feature tracking remains explicit.

### Follow-up Priorities

1. Extend contract storage schema to preserve FK referential actions.
2. Extend index model to preserve sort/operator class/algorithm/fulltext semantics.
3. Add multi-schema storage metadata support.
4. Add conversion support for additional advanced Prisma/Postgres features with migration op coverage.
