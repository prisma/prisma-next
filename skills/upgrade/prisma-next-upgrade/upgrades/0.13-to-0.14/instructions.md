---
from: "0.13"
to: "0.14"
changes:
  - id: qualify-flat-builder-accessors
    summary: |
      The builder-layer flat accessors are removed: the query builder and ORM client now
      expose per-namespace facets only, and the Postgres facade exposes the qualified
      surface. Code that builds queries against a Postgres (multi-namespace) contract must
      name the namespace the table/model is declared in: `db.sql.<table>` becomes
      `db.sql.<namespace>.<table>` and `db.orm.<Model>` becomes
      `db.orm.<namespace>.<Model>` (for a standard single-schema Postgres project the
      namespace is `public`). Code that calls the builder outputs directly migrates the
      same way: `sql.<table>` → `sql.<namespace>.<table>`, `orm.<Model>` →
      `orm.<namespace>.<Model>`. SQLite and Mongo projects are unaffected — their
      single-namespace facade keeps flat `db.sql.<table>` / `db.orm.<Model>` working. There
      is no codemod: the correct namespace is the one each table/model is declared in, which
      is call-site-specific.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "db.sql."
        - "db.orm."
      anyMatch: true
---

<!--
TML-2838: the PGlite-backed example apps (`prisma-next-demo`, `react-router-demo`,
`supabase`, `bundle-size`, `multi-extension-monorepo`) switched their vitest
`pool` from `threads` to `forks`. Running PGlite (WebAssembly) across vitest
worker threads in one process intermittently aborts on Linux (a V8 JIT-page
race); a process-per-fork avoids it. Test-harness only — no runtime, contract,
or public-API change. Incidental substrate diff only.
-->

# 0.13 → 0.14 — User upgrade instructions

## `qualify-flat-builder-accessors`

The query builder and ORM client are now **always qualified by namespace**. The flat by-bare-name accessors are gone: there is no `sql.<table>` and no `orm.<Model>` at the builder layer, and the **Postgres** facade exposes the qualified surface (`db.sql` / `db.orm` are the namespace map). You reach a table or model by naming its namespace.

Namespace selection separates *which namespace's table* from *the ergonomic shorthand for the single-namespace case*. The builder layer always names the namespace; the single-namespace shorthand is recovered by the facade on targets that have only one namespace (SQLite, Mongo).

### Who needs to change code

**Postgres projects** that build queries through the facade or the builder outputs. A standard Postgres project keeps its tables and models in the `public` schema, so the namespace to insert is `public`:

```ts
// Before
const users = await db.sql.user.select('id', 'email').build().execute();
const alice = await db.orm.User.find({ where: { id } });

// After — name the namespace the table/model is declared in (`public` for a standard schema)
const users = await db.sql.public.user.select('id', 'email').build().execute();
const alice = await db.orm.public.User.find({ where: { id } });
```

The same rule applies inside a `transaction` (`tx.sql.public.user`, `tx.orm.public.User`), inside a `prepare(...)` callback (`(sql) => sql.public.user…`), and to code that imports the builder outputs directly rather than through the facade (`sql.public.user`, `orm.public.User`). If your Postgres contract declares more than one namespace, name the namespace each table/model actually sits in — `db.sql.auth.user` for a table in the `auth` schema, `db.sql.public.profile` for one in `public`.

### Who does **not** need to change anything

**SQLite and Mongo projects.** These targets have a single namespace, so their facade still exposes the flat surface — `db.sql.<table>` and `db.orm.<Model>` keep working unchanged. No edits are required.

### How to migrate

There is no codemod, because the correct namespace is the one each table or model is declared in — a fact that lives at the call site, not in a mechanical rule. For each flagged file:

1. If the project's facade is SQLite or Mongo (`sqlite(...)` / `mongo(...)`), leave it unchanged.
2. If it is Postgres (`postgres(...)`), insert the namespace segment after `.sql` / `.orm` (and on direct `sql` / `orm` builder calls): use `public` for a standard single-schema project, or the specific schema name for each table/model in a multi-schema contract.

After migrating, run your project's `pnpm typecheck` (or equivalent) — a missed site is a compile error (`Property '<table>' does not exist on type 'Db<…>'`), so the type checker pins every remaining flat access for you.
