# @prisma-next/extension-sqlite-vector

SQLite vector extension pack for Prisma Next.

## Overview

This extension pack adds a `sqlite/vector@1` codec (stored as JSON text) and a `cosineDistance()` operation that lowers to a pure SQL expression (JSON1 + math functions).

## Notes

- SQLite does not ship a native vector type in this repo. Vectors are stored as `TEXT` containing JSON arrays.
- The cosine distance lowering requires:
  - JSON1 functions (`json_each`, `json_object`, etc.)
  - math functions (`sqrt`, etc.)

## Entrypoints

- `@prisma-next/extension-sqlite-vector/pack` for contract authoring
- `@prisma-next/extension-sqlite-vector/control` for `prisma-next.config.ts`
- `@prisma-next/extension-sqlite-vector/runtime` for execution stacks
