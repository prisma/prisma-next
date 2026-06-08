---
from: "0.12"
to: "0.13"
changes:
  - id: sqlite-create-table-method
    summary: |
      SQLite migrations: `createTable` is no longer a free function exported from `@prisma-next/sqlite/migration`. It is now a protected method on the `Migration` base class. If your extension ships SQLite migration files, replace every free `createTable(...)` call with `this.createTable({ table: ..., columns: [...], constraints: [...] })`. If your extension's migration facade re-export test asserts `createTable` is defined, remove that assertion. The `col()`, `lit()`, `fn()`, `primaryKey()`, `foreignKey()`, and `unique()` builder helpers are now exported from `@prisma-next/sqlite/migration` directly.
    detection:
      glob: "**/migration.ts"
      contains:
        - "createTable"
        - "@prisma-next/sqlite/migration"
      anyMatch: false
---

# 0.12 → 0.13 — Extension-author upgrade instructions

## `sqlite-create-table-method`

Starting at this release, `createTable` is no longer a free function exported from `@prisma-next/sqlite/migration`. It is now a protected method on the `Migration` base class — call it as `this.createTable({...})` inside `get operations()`.

If your extension ships SQLite migration files, update them to use `this.createTable(...)` and remove `createTable` from the import list.

If your extension has a facade re-export parity test that asserts `createTable` is defined, remove that assertion; add assertions for `col`, `lit`, `fn`, `primaryKey`, `foreignKey`, and `unique` if your test also checks that the column builders are exported.

The `col()`, `lit()`, `fn()`, `primaryKey()`, `foreignKey()`, and `unique()` builder helpers are now exported from `@prisma-next/sqlite/migration` directly.

See the user-skill entry `sqlite-create-table-method` for the full before/after migration steps — the authoring-surface change is identical for both user and extension migration files.
