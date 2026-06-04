---
from: "0.12"
to: "0.13"
changes:
  - id: re-emit-mti-variant-link-columns
    summary: |
      MTI variant models — PSL `@@base(Parent, "tag")` models that carry their own `@@map` and are therefore stored in their own table — now materialise a base-PK link column in storage. On re-emit, each such variant table gains an `id` column, a single-column primary key on it, and a cascading foreign key referencing the base table's primary key; the contract's `storageHash` changes accordingly. Re-emit your contract artefacts (`pnpm emit`), then advance your database with the corresponding migration (`prisma-next migration plan` → `prisma-next migrate`) so the variant tables gain the link column, PK, and cascading FK. Contracts whose variants share the base table (single-table inheritance, no own `@@map`) are unaffected.
    detection:
      glob: "**/contract.json"
      contains:
        - '"base":'
      anyMatch: true
    script: ./re-emit-mti-variant-link-columns.ts
---

<!--
TML-2808: the SQL/Mongo contract storage IR moved to a namespace
envelope (`namespaces.<ns>.entries.<kind>`) and lifted cross-references
from bare strings to `{ namespace, model }` objects in `domain`.
Consumer impact is incidental: re-emitting `contract.json` /
`contract.d.ts` via the existing `prisma-next contract emit` produces
the new shape with no source change. No codemod is required.
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

- an `id` column matching the base table's primary-key type,
- a single-column primary key on that `id`,
- a cascading foreign key (`ON DELETE CASCADE`) from the variant's `id` to the base table's `id`.

The variant row's `id` mirrors its parent base row's `id` — the same identity links a `task` row to its `bug`/`feature` detail row. This is the storage shape the runtime already assumed when writing base + variant rows together; the change makes it explicit and enforced at the database level.

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

The regenerated `contract.json` gains the variant `id` column, its primary key, and the cascading foreign key under `storage.namespaces.<ns>.tables.<variant>`, and the contract's `storageHash` changes. `contract.d.ts` picks up the new column on the variant's row type.

### Migrate your database

Re-emitting changes `storageHash`, so your live database needs the matching schema change. Plan and apply it:

```bash
prisma-next migration plan --name mti-variant-link-columns
prisma-next migrate
```

The plan adds the variant `id` column, sets it `NOT NULL`, adds the primary key, and adds the cascading foreign key to the base table.

A variant row's `id` **must equal its parent base row's `id`** — that shared identity is what links a `task` row to its `bug`/`feature` detail row, and the cascading foreign key to `task(id)` enforces it. There is therefore no correct backfill, and you must **never fabricate** a variant id (for example with `gen_random_uuid()`): a fabricated id has no matching `task` row, so the validating foreign key in this same migration would immediately reject it.

The runtime always wrote each variant row together with its base row, sharing the same `id`. On a database provisioned that way there are no rows missing an `id`, so the `SET NOT NULL` step is a no-op and the migration applies cleanly with no backfill. Author the migration with no `dataTransform` — just `addColumn` (nullable) → `setNotNull` → primary key → foreign key — then run `node <migration>.ts` (or `pnpm exec tsx <migration>.ts`) to self-emit `ops.json` and attest the package before `prisma-next migrate`.

If your database does hold variant rows that predate the link column, they are unlinkable orphans — nothing in those rows maps them back to their `task`. The `SET NOT NULL` precheck ("ensure no NULL values") halts the migration before any destructive step. Resolve those rows by hand — map each to the correct `task.id`, or delete it — and re-run. Do not paper over the halt with a fabricated id.

### Validation

After re-emitting and migrating, run `pnpm typecheck && pnpm test` (or your application's equivalent), then `prisma-next migration check` to confirm the on-disk chain is consistent. Inspect the `contract.json` diff: each MTI variant table should carry an `id` column, a `primaryKey` on it, and a cascading `foreignKey` to its base table.
