---
from: "0.13"
to: "0.14"
changes:
  - id: qualify-flat-builder-accessors
    summary: |
      The builder-layer flat accessors are removed: `@prisma-next/sql-builder`'s `sql()` and
      `@prisma-next/sql-orm-client`'s `orm()` now expose per-namespace facets only. Extension
      code that builds queries by accessing a bare table/model on the builder output
      (`sql.<table>` / `orm.<Model>`) must name the namespace the table/model is declared in:
      `sql.<namespace>.<table>`, `orm.<namespace>.<Model>` (`public` for a standard
      single-schema SQL contract; the late-bound `__unbound__` namespace for an unbound/SQLite
      contract). There is no codemod — the correct namespace is the one each table/model is
      declared in, which is call-site-specific. Extensions that only contribute codecs, types,
      or migrations (and never build queries through `sql`/`orm`) are unaffected.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "@prisma-next/sql-builder"
        - "@prisma-next/sql-orm-client"
      anyMatch: true
---

# 0.13 → 0.14 — Extension-author upgrade instructions

## `qualify-flat-builder-accessors`

The query builder (`@prisma-next/sql-builder`) and ORM client (`@prisma-next/sql-orm-client`) are now **always qualified by namespace**. The flat by-bare-name accessors are gone: the value returned by `sql({ … })` / `orm({ … })` is a map of per-namespace facets, so there is no `sql.<table>` and no `orm.<Model>` at the top level. You reach a table or model by naming its namespace.

This affects extension code that *builds queries* through these packages. Extensions that only contribute codecs, native types, or migration operations — and never construct a `sql`/`orm` query — need no change.

### Migrate query-building call sites

Insert the namespace segment after the builder output, naming the namespace each table/model is declared in:

```ts
// Before
const plan = sql.user.select('id', 'email').build();
const row  = await orm.User.find({ where: { id } });

// After — name the namespace (`public` for a standard single-schema SQL contract)
const plan = sql.public.user.select('id', 'email').build();
const row  = await orm.public.User.find({ where: { id } });
```

For an unbound contract (e.g. SQLite, or any target whose entities live in the late-bound namespace) the namespace segment is `__unbound__` — import `UNBOUND_NAMESPACE_ID` from `@prisma-next/framework-components/ir` and index with it (`sql[UNBOUND_NAMESPACE_ID].user`) rather than hard-coding the string. For a multi-namespace contract, name the specific namespace each table/model sits in.

### Validation

This is a type-level change — `pnpm typecheck` (or `pnpm build`) pinpoints every remaining flat access as a compile error (`Property '<table>' does not exist on type 'Db<…>'`). Fix each by inserting the namespace segment, then run your extension's standard `pnpm test`.
