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
  - id: sql-runtime-base-class-naming
    summary: |
      `@prisma-next/sql-runtime` now exports `abstract class SqlRuntimeBase` (previously
      `SqlRuntime`) — the family-layer subclass seam. Target classes are now named with
      `Impl` suffix: `PostgresRuntimeImpl` and `SqliteRuntimeImpl`. The bare names
      `PostgresRuntime` and `SqliteRuntime` are now interfaces — the correct types to
      depend on in extension and app code. App code using the facade factories
      (`postgres(...)`, `sqlite(...)`) is unaffected.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "SqlRuntime"
        - "PostgresRuntime"
        - "SqliteRuntime"
      anyMatch: true
  - id: create-runtime-removed
    summary: |
      `createRuntime` is removed from `@prisma-next/sql-runtime`. Use the target
      factory (`postgres(...)` / `sqlite(...)`) or construct the target class
      directly: `new PostgresRuntimeImpl({...})` from `@prisma-next/postgres/runtime`,
      `new SqliteRuntimeImpl({...})` from `@prisma-next/sqlite/runtime`. App code
      using the facade factories (`postgres(...)`, `sqlite(...)`) is unaffected.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "createRuntime"
---

<!--
TML-2867: codec-routed DDL defaults. The migration planner now resolves each plan
operation lazily (operations are `Promise<Op>[]`), and DDL execute steps carry a
`params` array. The example migration fixtures (`prisma-next-demo`,
`prisma-next-postgis-demo`) were regenerated to reflect the added `params` field.
No user-side API change. Incidental substrate diff only.
-->

<!--
TML-2852: the enum read surface. `enumType`-authored enums become first-class in
application code — an enum-restricted field's value union flows into the static
read/write types of both query lanes, `db.enums.<namespace>.<Name>` exposes the
enum at runtime (a lane-agnostic facade map), and `ORDER BY` on an enum column
sorts by declaration order. Purely additive and opt-in: PSL `enum` stays native
until the cutover, so only `enumType`-authored contracts exercise it, and
`fixtures:check` is byte-identical for every existing contract. No user-side
action — the examples/ diff is the new feature's demonstration. Incidental
substrate diff only.

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

## `sql-runtime-base-class-naming`

The SQL runtime class hierarchy now follows the repo naming convention:

- `SqlRuntime` (previously exported) → now `SqlRuntimeBase` (abstract family base)
- `PostgresRuntime` (previously a class) → now an **interface** (the type to depend on); the concrete class is `PostgresRuntimeImpl`
- `SqliteRuntime` (previously a class) → now an **interface** (the type to depend on); the concrete class is `SqliteRuntimeImpl`

App code using the facade factories (`postgres(...)`, `sqlite(...)`) is unaffected — those return `Runtime` / the interface. Only code that referenced the class names directly needs to change:

```ts
// Before — referencing the class as a type
import { PostgresRuntime } from '@prisma-next/postgres/runtime';
function takesRuntime(r: PostgresRuntime) { ... }

// After — use the interface (same import path)
import type { PostgresRuntime } from '@prisma-next/postgres/runtime';
function takesRuntime(r: PostgresRuntime) { ... }

// Before — subclassing
import { PostgresRuntime } from '@prisma-next/postgres/runtime';
class MyRuntime extends PostgresRuntime { ... }

// After — subclass the Impl
import { PostgresRuntimeImpl } from '@prisma-next/postgres/runtime';
class MyRuntime extends PostgresRuntimeImpl { ... }
```

## `create-runtime-removed`

`createRuntime` is removed from `@prisma-next/sql-runtime`. App code using the facade factories (`postgres(...)`, `sqlite(...)`) is unaffected — those still return a `Runtime` as before. Only code that imported and called `createRuntime` directly needs to change.

Replace direct `createRuntime` calls with the appropriate target class constructor or factory:

```ts
// Before
import { createRuntime } from '@prisma-next/sql-runtime';
const runtime = createRuntime({ stackInstance, context, driver, ...opts });

// After — use the target factory (recommended for app code)
import { postgres } from '@prisma-next/postgres';
const db = postgres({ contract, ...opts });
// runtime is accessed via db.connect() / db.runtime() etc.

// Or construct the target class directly (for advanced/test use)
import { PostgresRuntimeImpl } from '@prisma-next/postgres/runtime';
const runtime = new PostgresRuntimeImpl({ adapter: stackInstance.adapter, context, driver, ...opts });
```

The constructor options are identical to what `createRuntime` accepted, except `stackInstance` is not taken: pass `adapter` from `stackInstance.adapter` directly.

<!--
TML-2882: transitional PSL `enum2` block (PR #805). The demo authors `enum2 Priority`
and a `priority` field; emitted artifacts and migrations regenerate accordingly, and
the `ValueSetRef` carrier / `StorageValueSet` node tag land in their first persisted
form. Additive and opt-in: no existing consumer contract changes shape, native `enum`
is untouched, and re-emit round-trips. No consumer action required; the keyword is
transitional and is renamed to `enum` at the cutover (TML-2853), which will carry the
user-facing upgrade entry.
-->

<!--
TML-2855: member defaults via `@default(member)` (PR #808). The PSL interpreter and
contract-ts authoring surface now resolve `@default(EnumType.Member)` to a
`{ kind: 'literal', value: '<dbValue>' }` default. The demo `priority` field gains
`@default(Priority.Low)` and a new migration (`20260610T2216_set_priority_default`)
is emitted. Additive and opt-in: only fields that declare `@default(<EnumType>.<Member>)`
are affected; no existing contract changes shape. No consumer action required; the
cutover (TML-2853) will carry the user-facing docs.
-->
