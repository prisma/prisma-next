## Slice 3 — Stand Up Relational Core

### Context
- Slice 2 moved contract authoring; schema/table builders + column DSL remain in `@prisma-next/sql-query`.
- We need a reusable relational core package (`@prisma-next/sql-relational-core`) that hosts `schema.ts`, column builders, operation attachment, AST types, and related tests.

### Goals
1. Move `schema.ts`, `types.ts` (column + AST types), `param.ts`, and `operations-registry.ts` into `packages/sql/lanes/relational-core`.
2. Ensure the package exports the primitives used by SQL + ORM lanes (tables, columns, params, operation attachment helpers).
3. Update operation registry usage to import from the new package, but keep the runtime dependencies untouched for now.
4. Port tests (`column-builder-operations.test.ts`, `sql.test.ts` where applicable) to the new package or keep them pointing to it.
5. Maintain zero runtime behavior changes; just moving code + adjusting imports.

### Non-goals
- Splitting the SQL/ORM lanes (handled in Slice 4).
- Changing how operations are registered or executed (Slice 5 handles cross-package registry alignment if needed).
- Refactoring runtime context usage; still OK if relational core temporarily references runtime types, but prefer slimmer interfaces if easy.

### Deliverables
- `@prisma-next/sql-relational-core` package with build/test config and exports for schema, columns, params, operations registry helper.
- Updated `@prisma-next/sql-query` (or future lanes packages) importing from `@prisma-next/sql-relational-core`.
- Passing tests covering column builders + operations.

### Step Outline
1. Move the files into the new package, fixing relative imports + path aliases.
2. Update exports so existing entry points (`sql.ts`, `orm-builder.ts`) consume from relational core.
3. Relocate/adjust associated tests.
4. Run targeted tests + typechecks.

### Testing / Verification
- `pnpm --filter @prisma-next/sql-relational-core test`
- `pnpm --filter @prisma-next/sql-query test`
- `pnpm lint`

### Notes
- Ensure operations registry brief (Slice 11) remains linked for context; we’re only moving code, not refactoring logic yet.
