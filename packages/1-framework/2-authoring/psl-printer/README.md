# @prisma-next/psl-printer

> **Internal package.** This package is an implementation detail of [`prisma-next`](https://www.npmjs.com/package/prisma-next)
> and is published only to support its runtime. Its API is unstable and may change
> without notice. Do not depend on this package directly; install `prisma-next` instead.

Prints Prisma Schema Language (PSL) from `PslDocumentAst` (`@prisma-next/psl-types`).

## Overview

`@prisma-next/psl-printer` renders deterministic PSL text from the parser AST for brownfield authoring and introspection flows. A temporary `./legacy` entry (removed in M2) still validates SQL introspection IR and prints via AST for Postgres-only callers.

## Responsibilities

- Convert structured AST (`model`, `field`, `enum`, `types`) into valid PSL output.
- Preserve `@map` / `@@map` and relation attributes from AST nodes.
- Generate deterministic output so snapshot-based tests remain stable.

## Dependencies

- **Depends on**
  - `@prisma-next/contract`
  - `@prisma-next/psl-parser`
  - `@prisma-next/psl-types`
  - `@prisma-next/sql-schema-ir` (legacy shim only; single gateway module under `src/`)
  - `@prisma-next/utils`
- **Used by**
  - `@prisma-next/cli` (`contract infer` uses `./legacy` until M2)

## Related Docs

- `docs/Architecture Overview.md`
- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
