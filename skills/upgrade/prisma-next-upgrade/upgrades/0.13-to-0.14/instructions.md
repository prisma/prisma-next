---
from: "0.13"
to: "0.14"
changes:
  - id: uuid-preset-rename
    summary: |
      The uuid field presets are renamed: `field.uuid()` → `field.uuidString()`,
      `field.id.uuidv4()` → `field.id.uuidv4String()`, `field.id.uuidv7()` →
      `field.id.uuidv7String()`. These names now describe the storage encoding
      (char(36) string). Postgres-native uuid storage uses the new
      `field.uuidNative()` / `field.id.uuidv4Native()` / `field.id.uuidv7Native()`
      presets from `@prisma-next/postgres/contract-builder`.
    detection:
      glob: "**/*.ts"
      contains:
        - "field.uuid()"
        - "field.id.uuidv4()"
        - "field.id.uuidv7()"
      anyMatch: true
    script: uuid-preset-rename.ts
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
  - id: enum-becomes-domain-concept
    summary: |
      The PSL `enum` keyword now authors the domain enum (a text-class column whose
      value set is enforced by a CHECK constraint) — the native Postgres
      `CREATE TYPE … AS ENUM` semantics are gone. An `enum` block must carry
      `@@type("<codec-id>")` (e.g. `@@type("pg/text@1")`), members map to database
      values with `Name = "value"` (a bare member name defaults to itself where the
      codec accepts it), and `@map` on members is removed — the member value IS the
      mapping. The transitional `enum2` keyword is retired; rename those blocks to
      `enum` (emitted contract is identical). The TS authoring equivalent is
      `enumType(name, codecRef, ...member(name, value))` from
      `@prisma-next/postgres/contract-builder` returned under the contract's `enums`
      key; the old native `enumType(name, values[])` / `enumColumn` from
      `@prisma-next/adapter-postgres/column-types` are deleted. Databases that
      already carry a native enum type need a one-time converting migration (alter
      column to text USING ::text, add the value-set CHECK, DROP TYPE) — `contract
      infer` refuses native enum types by design and names them in its diagnostic.
    detection:
      glob: "**/*.prisma"
      contains:
        - "enum "
        - "enum2 "
      anyMatch: true
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
`pool` from `threads` to `forks` and pass `--no-memory-protection-keys`. Running
PGlite (WebAssembly) across vitest worker threads intermittently aborts on Linux
with a residual V8 JIT-page race (`jit_page_->allocations_.erase`) that
`@prisma/dev` 0.24.12 reduced but did not fully eliminate; process-per-fork with
PKU JIT-hardening disabled removes it. Test-harness only — no runtime, contract,
or public-API change. Incidental substrate diff only.
-->

# 0.13 → 0.14 — User upgrade instructions

## `uuid-preset-rename`

The uuid field preset names now include the storage encoding suffix:

| Before | After |
| --- | --- |
| `field.uuid()` | `field.uuidString()` |
| `field.id.uuidv4()` | `field.id.uuidv4String()` |
| `field.id.uuidv7()` | `field.id.uuidv7String()` |

These presets store UUIDs as `char(36)` strings and work across all SQL targets. If you want the Postgres-native `uuid` column type instead, use `field.uuidNative()` / `field.id.uuidv4Native()` / `field.id.uuidv7Native()` from `@prisma-next/postgres/contract-builder`.

The rename is mechanical. Run the colocated script or apply the following find-and-replace in your `contract.ts` (or wherever you use the field builder):

```ts
// Before
id: field.id.uuidv7(),
userId: field.id.uuidv4(),
externalId: field.uuid(),

// After
id: field.id.uuidv7String(),
userId: field.id.uuidv4String(),
externalId: field.uuidString(),
```

No change to `contract.json` — both the old and new preset names emit the same codec (`sql/char@1`), so existing emitted contracts remain valid.

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

## `enum-becomes-domain-concept`

The `enum` keyword changed meaning. Before 0.14 a PSL `enum` block authored a **native Postgres enum** (`CREATE TYPE <name> AS ENUM (…)`, columns typed with the named type). Starting at 0.14 the same keyword authors the **domain enum**: the column stores plain values through a declared codec (typically `pg/text@1` → a `text` column) and the value set is enforced by a CHECK constraint the migration planner generates and verifies. The native enum machinery (the `pg/enum@1` codec, native `CREATE TYPE` planning, native-enum introspection adoption) is deleted.

### Who needs to change code

Any project whose `.prisma` schema contains an `enum` block **without** an `@@type(...)` attribute (the old native form), or with `@map` on members, or whose schema uses the transitional `enum2` keyword. Projects that already author enums with `@@type` + member values (the `enum2`-era shape introduced in 0.13) only need the keyword rename described below — the emitted contract is identical.

### 1. Convert the schema syntax

```prisma
// Before — native enum (0.13)
enum user_type {
  admin
  user
}

// After — domain enum (0.14)
enum user_type {
  @@type("pg/text@1")
  admin = "admin"
  user  = "user"
}
```

Rules:

- `@@type("<codec-id>")` is **required**. For string-valued enums use `@@type("pg/text@1")`.
- Each member maps to its database value with `member = "value"`. Under the native semantics the stored label was the member name, so a faithful conversion sets each value to the member's name (`admin = "admin"`). A member that previously carried `@map("dbvalue")` becomes `member = "dbvalue"` — `@map` on enum members is removed; the member value is the mapping.
- If your schema uses the transitional `enum2` keyword (added in 0.13), rename `enum2` → `enum`. Nothing else changes — that block shape is exactly what `enum` now means.

If you author contracts in TypeScript instead of PSL: the native `enumType(name, values[])` and `enumColumn(...)` helpers from `@prisma-next/adapter-postgres/column-types` are deleted. Author the domain enum with `enumType` + `member` from your target's contract-builder and return it under the `enums` key:

```ts
import { defineContract, enumType, member } from '@prisma-next/postgres/contract-builder';

const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;
const UserType = enumType('user_type', pgText, member('admin', 'admin'), member('user', 'user'));

export const contract = defineContract({ /* … */ }, ({ field, model }) => ({
  enums: { user_type: UserType },
  models: {
    User: model('User', {
      fields: { /* … */ kind: field.namedType(UserType) },
    }),
  },
}));
```

Then re-emit: `prisma-next contract emit`. The emitted contract carries the enum as a domain entity plus a storage `valueSet`; the column becomes `pg/text@1` / `text` with a `valueSet` reference and a table-level check entry.

### 2. Migrate the database off the native type

A database created under 0.13 still has the native enum type and columns typed with it. Author a one-time converting migration — for each native enum type, in order:

1. Alter each column off the native type, casting the stored labels: `ALTER TABLE … ALTER COLUMN <col> TYPE text USING <col>::text`.
2. Add the value-set CHECK constraint the contract now declares (name it as the contract does, e.g. `<table>_<col>_check`).
3. Drop the native type: `DROP TYPE "<schema>"."<type>"`.

Because the contract hash does not change (the schema conversion in step 1 and the emitted contract are the end state), scaffold the migration as a data-only edge on the current hash: `prisma-next migration new --name convert-<type>-to-value-set --from <current-storage-hash>`, give the ALTER op `operationClass: 'data'`, and self-emit by running the scaffolded `migration.ts`. The `DROP TYPE` has no op builder — express it as an inline `rawSql` op.

A complete worked example ships in the Prisma Next repo: `examples/prisma-next-demo/migrations/app/20260611T1856_convert_user_type_to_value_set/migration.ts` — three ops (data-class ALTER … USING, `addCheckConstraint`, rawSql `DROP TYPE`), each with pre/postchecks that make replay idempotent.

Note: `prisma-next contract infer` **refuses** databases containing native enum types — it names each offending type and points at this conversion. Convert the database first, then infer.

### 3. Verify

Run `prisma-next db verify` (or your project's test suite) after applying the converting migration: the live schema must now match the contract — `text` column, CHECK constraint present, native type gone.

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

<!--
TML-2885: typed domain enum block in emitted contract.d.ts (PR #809). The emitter
now generates a `domain` block in `contract.d.ts` that exposes each PSL-authored enum
as a `ContractEnumAccessor<Entry>` with literal `values`, `names`, and `members` types.
`contract.json` is unchanged — the enum data was already there; this is a types-only
addition. Consumers that re-emit gain a literal-typed `db.enums.<namespace>.<Name>`
surface at compile time (e.g. `db.enums.public.Priority.members.Low` resolves to
`'low'` rather than `string`). Additive — no existing contract shape changes.
No consumer action required.
-->

<!--
TML-2886: typed ALTER TABLE … ADD COLUMN via AlterTable DDL IR (PR #813). The
example migrations that used the bare `addColumn()` helper are updated to
`this.addColumn(...)` (the method on the `Migration` base class, which now carries
full column typing via the `col()` builder). The column-attribute order in emitted
CREATE TABLE SQL changed from `… NOT NULL DEFAULT …` to `… DEFAULT … NOT NULL` as a
by-product of the AlterTable IR alignment. The example fixture snapshots are
regenerated accordingly. No user-facing contract or migration format change.
Incidental substrate diff only.
-->

<!--
#788: enum input types widened to their member union in emitted contract.d.ts (PR
#797). The emitter now renders an enum-restricted field's input type as the literal
member union on the write side, matching the existing output side: a `pg/enum@1`
field's `FieldInputTypes` entry flips from `CodecTypes['pg/enum@1']['input']` (≈
`string`) to e.g. `'admin' | 'user'`. The example `contract.d.ts` goldens are
regenerated accordingly. `contract.json` is unchanged — this is a types-only
addition that makes create/update exhaustiveness-checked. Additive; no existing
contract shape changes. No consumer action required. Incidental substrate diff only.
-->
