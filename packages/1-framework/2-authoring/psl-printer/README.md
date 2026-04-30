# @prisma-next/psl-printer

> **Internal package.** This package is an implementation detail of [`prisma-next`](https://www.npmjs.com/package/prisma-next)
> and is published only to support its runtime. Its API is unstable and may change
> without notice. Do not depend on this package directly; install `prisma-next` instead.

Prints Prisma Schema Language (PSL) from `PslDocumentAst` (`@prisma-next/psl-types`).

## Overview

`@prisma-next/psl-printer` renders deterministic PSL text from a `PslDocumentAst` (defined in `@prisma-next/psl-types`). The package is target-agnostic: SQL → AST construction lives in the SQL family (`@prisma-next/family-sql`'s `inferPslContract` capability).

## Responsibilities

- Convert structured AST (`model`, `field`, `enum`, `types`) into valid PSL output.
- Preserve `@map` / `@@map` and relation attributes from AST nodes.
- Generate deterministic output so snapshot-based tests remain stable.

## Dependencies

- **Depends on**
  - `@prisma-next/psl-types`
- **Used by**
  - `@prisma-next/cli` (consumes `printPsl(ast)` after the SQL family produces the AST)
  - `@prisma-next/family-sql` (tests; consumes the printer to verify AST construction)

## Related Docs

- `docs/Architecture Overview.md`
- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
