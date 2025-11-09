# @prisma-next/sql-orm-lane

**Status:** Scaffolded placeholder package

This package will contain ORM builder, include compilation, and relation filters for Prisma Next.

## Overview

This package is part of the SQL lanes ring and will provide:
- ORM query builder
- Include compilation (ORM includes compile to SQL lane primitives like `includeMany`)
- Relation filter utilities

**Note:** This package compiles ORM queries to SQL lane primitives (AST nodes). Dialect-specific lowering to SQL strings happens in adapters (per ADR 015 and ADR 016).

## Package Status

This package is currently a placeholder created during the package layering scaffolding phase. Implementation will be added in a future slice.

