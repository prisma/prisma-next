---
from: "0.12"
to: "0.13"
changes:
  - id: re-emit-mti-variant-link-columns
    summary: |
      MTI variant models — PSL `@@base(Parent, "tag")` models that carry their own `@@map` and are therefore stored in their own table — now materialise base-PK link columns in storage. On re-emit, each such variant table gains a copy of the base table's full primary-key column set (same names and types), a primary key over those columns, and a cascading foreign key referencing the base table's primary key; the contract's `storageHash` changes accordingly. Re-emit your contract artefacts (`pnpm emit`), then advance your database with the corresponding migration (`prisma-next migration plan` → `prisma-next migrate`) so the variant tables gain the link column, PK, and cascading FK. Contracts whose variants share the base table (single-table inheritance, no own `@@map`) are unaffected.
    detection:
      glob: "**/contract.json"
      contains:
        - '"base":'
      anyMatch: true
    script: ./re-emit-mti-variant-link-columns.ts
  - id: cross-space-fk-psl-pattern
    summary: |
      New opt-in PSL authoring pattern: reference a model from an extension contract space
      (e.g. `supabase:auth.AuthUser`) in a relation field and declare a named-type alias
      (`types { Uuid = String @db.Uuid }`) for database-native types. No action required
      for consumers who do not use cross-space foreign keys; this entry documents the
      pattern for new adopters.
  - id: storage-namespace-envelope-re-emit
    summary: |
      The storage IR in `contract.json` moved to a namespace envelope
      (`storage.namespaces.<ns>.entries.<kind>`). This changes `storageHash` for every
      SQL and Mongo contract. Re-emit your contract artefacts (`prisma-next contract
      emit`), then plan and apply the corresponding migration (`prisma-next migration
      plan` → `prisma-next migrate`) so your database schema is reconciled with the new
      contract shape. No source change is required — re-emitting is sufficient.
    detection:
      glob: "**/contract.json"
      anyMatch: true
  - id: telemetry-now-opt-out
    summary: |
      Telemetry is now opt-out by default. If you previously relied on the opt-in
      default to keep telemetry off, set `PRISMA_NEXT_DISABLE_TELEMETRY=1` or
      `DO_NOT_TRACK=1` in your environment to restore that behaviour. No code change
      is required.
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
TML-2500(M3b): advances the `examples/supabase` walking skeleton to wire a
cross-space FK from `public.Profile.userId` to `supabase:auth.AuthUser.id` with
a cascading delete. The diff is new sample code that exercises a capability
shipped in M2/M3a — no existing consumer has cross-space FKs to migrate. This
entry serves as the canonical first-use reference for the PSL authoring pattern.

dependabot/runtime-deps: bumped pg 8.20→8.21, pg-cursor 2.19→2.20, vitest 4.1.6→4.1.7,
vite 8.0.13→8.0.15, tsdown 0.22.0→0.22.1, tsx 4.22.3→4.22.4, next 16.2.4→16.2.6,
postcss 8.5.14→8.5.15, evlog 2.16.0→2.18.1, @prisma/dev 0.24.7→0.24.8,
@types/node 25.6.0→25.9.1 — all incidental to examples; no user-side action required.

TML-2808: the SQL/Mongo contract storage IR moved to a namespace
envelope (`namespaces.<ns>.entries.<kind>`) and lifted cross-references
from bare strings to `{ namespace, model }` objects in `domain`.
Consumer impact is incidental: re-emitting `contract.json` /
`contract.d.ts` via the existing `prisma-next contract emit` produces
the new shape with no source change. No codemod is required.

TML-2834: scaffolds the new `@prisma-next/extension-supabase` package
and adds `examples/supabase` as the Supabase walking-skeleton app. Two
enabling framework changes ride along: (a) the emitter now emits
multi-namespace contracts (single-namespace output is byte-identical),
and (b) `db init` / `db verify` introspect all declared namespaces
across a composed contract aggregate instead of only `public`. Both
are forward-compatible — single-namespace contracts emit byte-identical
output and introspect through the same path as before. The new
extension package is purely additive (consumers opt in by adding
`extensionPacks: [supabasePack]`). No codemod or user-side action
required.

TML-2754: points stale migration tests at the post-#751
`SqlControlAdapter` API (`createPlanner(controlAdapter)` and the
`adapter` option on `executeDbInit`/`executeDbUpdate`). Touches
`examples/multi-extension-monorepo/test/` only — a test-only diff with
no runtime, contract, or public-API change; incidental to examples, no
user-side action required.

dependabot/runtime-deps (PR #761): bumps react 19.2.6→19.2.7, vitest
4.1.7→4.1.8, next 16.2.6→16.2.7, react-router 7.15.1→7.16.0, vite
8.0.15→8.0.16, lucide-react 1.16.0→1.17.0, @prisma/dev 0.24.8→0.24.9,
mongodb-memory-server 11.1.0→11.2.0. Touches examples/ only via
package.json version fields; no runtime, contract, or public-API change.

TML-2838: regenerates example-app migration snapshots via pnpm
fixtures:emit. The prisma-next-demo initial migration was updated from
the removed standalone createTable function to this.createTable({...})
(the base-class method introduced by the planner-create-table-adopts-ddl-ast
refactor). The ops.json snapshots are regenerated accordingly. No
user-side action required.

TML-2843: `@prisma-next/sqlite` gained an additive facade transaction
API (`db.transaction(async (tx) => …)`) demonstrated in
`examples/prisma-next-demo-sqlite`. No user action required; incidental
substrate diff.

Release bump 0.13.0 (#789): version-number changes across all workspace
`package.json` files and `pnpm-lock.yaml` specifiers; the
`examples/supabase/src/contract.json` and `contract.d.ts` `version`
field updated to `0.13.0`. Incidental substrate diff — no user-side
action required.
-->

# 0.12 → 0.13 — User upgrade instructions

## `re-emit-mti-variant-link-columns`

Starting at this release, a Multi-Table Inheritance (MTI) variant model stores an explicit link to its base row. An MTI variant is a PSL model that declares `@@base(Parent, "tag")` **and** carries its own `@@map`, so it lives in a dedicated table rather than sharing the base table:

```prisma
model Task {
  id   String @id @default(uuid())
  type String
  // …
  @@discriminator(type)
  @@map("task")
}

model Bug {
  severity String
  @@base(Task, "bug")
  @@map("bug")
}
```

Before this release, the `bug` table held only the variant-specific columns (`severity`, …) with **no primary key** and no relationship to `task`. From this release on, re-emitting the contract materialises the base-PK link in the variant's storage table:

- a copy of the base table's full primary-key column set — the same column names and types (one column for a single-column PK like `id`, or every component for a composite PK),
- a primary key over those link columns,
- a cascading foreign key (`ON DELETE CASCADE`) from those columns to the base table's matching primary-key columns.

The variant row's link columns mirror its parent base row's primary key — the same identity links a `task` row to its `bug`/`feature` detail row. This is the storage shape the runtime already assumed when writing base + variant rows together; the change makes it explicit and enforced at the database level.

Single-table inheritance variants — `@@base(...)` models **without** their own `@@map`, which share the base table — are unaffected: there is no separate table to link.

### Re-emit your contracts

Run the colocated script from your project root:

```bash
pnpm exec tsx ./re-emit-mti-variant-link-columns.ts
```

It walks the project for `prisma-next.config.ts` directories, resolves each space's committed `contract.json`, and re-emits any contract whose MTI variant table still lacks its link column (an MTI variant model whose storage table has no `primaryKey`). It prefers a package's `emit` script when present, otherwise runs `prisma-next contract emit --config <path>`.

Use `--check` for a dry-run that lists the contract-spaces still needing re-emit and exits non-zero if any remain:

```bash
pnpm exec tsx ./re-emit-mti-variant-link-columns.ts --check
```

The regenerated `contract.json` gains the variant's link columns (the base PK's column set), their primary key, and the cascading foreign key under `storage.namespaces.<ns>.tables.<variant>`, and the contract's `storageHash` changes. `contract.d.ts` picks up the new columns on the variant's row type.

### Migrate your database

Re-emitting changes `storageHash`, so your live database needs the matching schema change. Plan and apply it:

```bash
prisma-next migration plan --name mti-variant-link-columns
prisma-next migrate
```

The plan adds the variant's link columns, sets them `NOT NULL`, adds the primary key over them, and adds the cascading foreign key to the base table.

A variant row's link columns **must equal its parent base row's primary key** — that shared identity is what links a `task` row to its `bug`/`feature` detail row, and the cascading foreign key to the base table enforces it. There is therefore no correct backfill, and you must **never fabricate** the link values (for example with `gen_random_uuid()`): fabricated values have no matching base row, so the validating foreign key in this same migration would immediately reject them.

The runtime always wrote each variant row together with its base row, sharing the same primary-key values. On a database provisioned that way there are no rows missing the link columns, so the `SET NOT NULL` step is a no-op and the migration applies cleanly with no backfill. Author the migration with no `dataTransform` — just `addColumn` (nullable) → `setNotNull` → primary key → foreign key — then run `node <migration>.ts` (or `pnpm exec tsx <migration>.ts`) to self-emit `ops.json` and attest the package before `prisma-next migrate`.

If your database does hold variant rows that predate the link columns, they are unlinkable orphans — nothing in those rows maps them back to their base row. The `SET NOT NULL` precheck ("ensure no NULL values") halts the migration before any destructive step. Resolve those rows by hand — map each to the correct base primary key, or delete it — and re-run. Do not paper over the halt with fabricated link values.

### Validation

After re-emitting and migrating, run `pnpm typecheck && pnpm test` (or your application's equivalent), then `prisma-next migration check` to confirm the on-disk chain is consistent. Inspect the `contract.json` diff: each MTI variant table should carry the base PK's link columns, a `primaryKey` over them, and a cascading `foreignKey` to its base table.

## `cross-space-fk-psl-pattern`

This release ships PSL support for referencing a model from an extension contract space (e.g. `supabase:auth.AuthUser`) in a relation field, together with named-type aliases for database-native column types.

**This entry is informational.** No existing consumer has cross-space foreign keys to change — this is a new opt-in capability. Adopt it when you want a field in your model to reference a row owned by an extension (such as Supabase's `auth.users` table).

### Named-type aliases

Declare a `types` block at the top of your `contract.prisma` to give a database-native type a reusable name:

```prisma
types {
  Uuid = String @db.Uuid
}
```

You can then use `Uuid` as a field type anywhere in the same contract. On emit the column receives `nativeType: "uuid"` in `contract.json`.

### Cross-space relation field

Reference another contract space's model using the `<space>:<namespace>.<Model>` syntax in a relation field. The relation requires `extensionPacks` to declare the dependency on the space:

```prisma
// Before (no cross-space FK)
namespace public {
  model Profile {
    id       String @id @default(uuid())
    username String
    @@map("profile")
  }
}

// After (cross-space FK to supabase:auth.AuthUser)
types {
  Uuid = String @db.Uuid
}

namespace public {
  model Profile {
    id       String @id @default(uuid())
    username String
    userId   Uuid   @unique
    user     supabase:auth.AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)
    @@map("profile")
  }
}
```

On emit, `contract.json` gains:
- A `types.Uuid` entry under `storage` for the named-type alias.
- The `userId` column with `typeRef: "Uuid"` on the storage table.
- A cross-space `foreignKey` entry on the storage table pointing at the extension space's table.

Run `prisma-next contract emit` after updating `contract.prisma`, then plan and apply the migration (`prisma-next migration plan --name add-user-fk && prisma-next migrate`) to add the column and foreign key to your database.

## `storage-namespace-envelope-re-emit`

The storage IR inside `contract.json` moved to a namespace envelope in 0.13. Every
table and type entry that was previously at the top level of `storage` now lives under
`storage.namespaces.<ns>.entries.<kind>`. Cross-references that were bare strings are
now `{ namespace, model }` objects in `domain`. The emitter handles this automatically
— no schema source change is needed.

Because the shape change affects `storageHash`, every SQL and Mongo contract must be
re-emitted, and the database must be migrated to match.

### Re-emit your contract

```bash
prisma-next contract emit
```

### Migrate your database

```bash
prisma-next migration plan --name storage-namespace-envelope
prisma-next migrate
```

The migration records the hash transition; no column or table is added or removed — this
is a metadata-only change. Confirm with `prisma-next migration check` once done.

## `telemetry-now-opt-out`

**Informational — no code change required.**

Starting at 0.13, the CLI collects anonymised usage telemetry by default (previously
opt-in). If you want to disable it, set either of the following environment variables:

```bash
PRISMA_NEXT_DISABLE_TELEMETRY=1
# or
DO_NOT_TRACK=1
```

Either variable takes effect immediately — no config file change needed. See
[Telemetry](https://github.com/prisma/prisma-next/blob/main/docs/Telemetry.md) for
what is collected and how to opt out permanently.
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
