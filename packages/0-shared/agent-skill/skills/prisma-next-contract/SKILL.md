---
name: prisma-next-contract
description: Edit the Prisma Next data contract — add models, fields, relations, indexes, enums, type aliases, polymorphic types (`@@discriminator` / `@@base`), use extension namespaces (`pgvector.Vector(...)`, `cipherstash.EncryptedString(...)`), wire `prisma-next.config.ts` with `defineConfig`, `prismaContract`, `typescriptContract`, and run `prisma-next contract emit`. Use for schema, models, fields, attributes, soft delete, paranoid, scopes, validations, callbacks, prisma schema, PSL, contract.prisma, contract.ts, contract.json, contract.d.ts, extensionPacks, pgvector, cipherstash, PN-CLI-4002, PN-CLI-4003, PN-CLI-4011.
---

# Prisma Next — Contract Authoring

> **Edit your data contract. Prisma handles the rest.**

The data contract is the single source of truth for your data layer. You edit a contract source — `contract.prisma` (PSL, the canonical surface) or `contract.ts` (TypeScript builder) — and the framework derives types, migrations, and runtime configuration from it. The three-step user model:

1. **You edit your data contract.**
2. **The system plans the migrations for you.** (`prisma-next-migrations`)
3. **If you need data migrations, you edit `migration.ts` and execute it.** (`prisma-next-migrations`)

Behind step 1 the agent runs `prisma-next contract emit` after every contract edit (or installs the Vite plugin so the bundler runs it on save — see `prisma-next-build`). Emit reads the contract source through the provider declared in `prisma-next.config.ts` and writes two artefacts colocated with the source:

- `contract.json` — the canonical, content-hashed Contract IR. Read by the planner, the runtime, and `db verify`.
- `contract.d.ts` — the precise TypeScript types the runtime + lanes propagate when you import `Contract` from it.

Both files are **emitted artefacts**. Edit the source; never the JSON or `.d.ts`.

## When to Use

- User wants to add, change, or remove a model / field / relation.
- User wants to add an index, unique constraint, or enum.
- User wants to use a custom type from an extension (`pgvector.Vector(length: 1536)`, `cipherstash.EncryptedString({...})`).
- User wants to install or configure an extension via `extensionPacks` in `prisma-next.config.ts`.
- User is migrating between authoring sources (PSL ↔ TypeScript builder).
- User received `PN-CLI-4002`, `PN-CLI-4003`, or `PN-CLI-4011` from `contract emit`.
- User mentions: *schema, fields, models, attributes, prisma schema, PSL, contract.prisma, contract.ts, contract.json, contract.d.ts, contract emit, extensionPacks, pgvector, cipherstash, validations, callbacks, soft delete, paranoid, scopes*. (The last cluster routes to *What Prisma Next doesn't do yet* below.)

## When Not to Use

- User wants to apply a contract change to the DB → `prisma-next-migrations`.
- User wants to write a query against the contract → `prisma-next-queries`.
- User wants to wire `db.ts` (runtime entry point, middleware, env config) → `prisma-next-runtime`.
- User wants the Vite / bundler integration → `prisma-next-build`.
- User wants to set up Prisma Next for the first time → `prisma-next-quickstart`.
- User wants a deeper read of a single structured error envelope → `prisma-next-debug`.
- User wants to file a missing-feature request → `prisma-next-feedback`.

## Key Concepts

- **Contract source.** A file the framework reads and lowers to the canonical Contract IR. Two flavours, both first-class:
  - **`contract.prisma` (PSL)** — schema-flavoured DSL. Canonical for typical apps and brownfield Prisma users. Wired by `prismaContract('./<path>/contract.prisma', { output, target })` from `@prisma-next/sql-contract-psl/provider`.
  - **`contract.ts` (TypeScript builder)** — programmatic authoring with `defineContract({...}, ({ field, model, rel, type }) => ({...}))` from `@prisma-next/sql-contract-ts/contract-builder` (or `@prisma-next/mongo-contract-ts/contract-builder` for Mongo). Wired by `typescriptContract(contract, '<path>/contract.json')` from `@prisma-next/sql-contract-ts/config-types`. Use when you need programmatic composition (per-tenant variants, generated fields) or constructs PSL doesn't yet express (e.g. registering a parameterised extension type — see pgvector's contract).
- **`prisma-next.config.ts`.** Wires the family + target + adapter + driver + extension packs + contract source. Use `defineConfig({...})` from `@prisma-next/cli/config-types`. The `contract` field takes a `ContractConfig` produced by `prismaContract(...)` or `typescriptContract(...)` — there is no `contract.path` or `contract.authoring` key.
- **Emit pipeline.** `prisma-next contract emit --config <path>?` calls `contract.source.load(context)`, validates the resulting Contract, then atomically writes `contract.json` + `contract.d.ts` to the configured output (or the provider's default — colocated with the source for both PSL and TS builder; falls back to `src/prisma/contract.json` for in-memory TS contracts with no path to anchor on).
- **Extension namespaces.** Extensions contribute namespaced constructors (`pgvector.Vector(length: 1536)`, `cipherstash.EncryptedString({equality: true})`) and helper presets. Install them by adding the descriptor to `extensionPacks` in the **config** (`extensionPacks: [pgvector]`, array of control descriptors) and — for the TS builder — to `extensionPacks` in **`defineContract`** (`extensionPacks: { pgvector }`, record of pack descriptors). The names are intentionally the same; the data shapes differ because the two surfaces consume different descriptor types.
- **Contract space.** Each package that emits its own contract (your app, an internal extension package, a published extension) follows the same on-disk layout: `prisma-next.config.ts` at package root; `src/contract.prisma` (or `src/contract.ts`); `src/contract.{json,d.ts}` colocated with the source; `migrations/` at package root. See `.cursor/rules/contract-space-package-layout.mdc`.

## Diagnostic codes you route on

`prisma-next contract emit` surfaces structured errors with stable codes; branch on `code` rather than message text.

| Code | Meaning | Next move |
|---|---|---|
| `PN-CLI-4002` *Contract configuration missing* | `contract` (or `contract.output`) not in `prisma-next.config.ts`. | Add `contract: prismaContract('./contract.prisma', { output, target })` (or `typescriptContract(contract, 'output/contract.json')`) to `defineConfig({...})`. |
| `PN-CLI-4003` *Contract validation failed* | Source loaded but the Contract IR failed structural validation. | Read `meta.diagnostics` / `meta.issues` for the offending model/field, fix the source, re-emit. |
| `PN-CLI-4011` *Missing extension packs in config* | The contract uses a namespaced constructor (e.g. `pgvector.Vector(...)`) but `extensionPacks` in the config does not list a matching descriptor. `meta.missingExtensionPacks` names them. | Install the package, import the control descriptor, add it to `extensionPacks` in `prisma-next.config.ts`. |

## Workflow — Read the contract source of truth

The concept: every contract change starts by locating the source file. The config is authoritative — the agent reads `prisma-next.config.ts` to resolve the `contract.source` provider and any extension packs already installed, then opens the source file the provider points at.

```bash
cat prisma-next.config.ts
```

Look for the `contract:` field. `prismaContract('./...contract.prisma', ...)` → PSL source at the first argument. `typescriptContract(contract, '...')` → TS source at the file that exports `contract`. If `prisma-next.config.ts` is missing, route to `prisma-next-quickstart`.

## Workflow — Edit a model / field / relation (PSL)

The concept: PSL models lower to tables (or collections, on Mongo); fields lower to columns; `@relation(...)` declares the FK side. Add the relation only on the owning side — the framework derives the back-reference automatically.

```prisma
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@unique([title, authorId])
  @@index([authorId])
}
```

Then run `pnpm prisma-next contract emit` (or rely on the Vite plugin — see `prisma-next-build`). Specify cascade behaviour explicitly with `onDelete` / `onUpdate`; the default is `Restrict`.

PSL alias surface for repeated types lives in a top-level `types {}` block:

```prisma
types {
  Email = String
}

model User {
  id    Int    @id @default(autoincrement())
  email Email  @unique
}
```

Note: scalar lists (e.g. `String[]`) and implicit Prisma-ORM many-to-many (list nav on both sides without a join model) are rejected by the SQL interpreter — use a join model. Composite/embeddable types (`type Address { ... }` with `address Address` on a model) are not supported by the SQL contract today.

## Workflow — Edit a model / field / relation (TS builder)

The concept: same model, different authoring surface. Use the structural API (`field.column(<columnDescriptor>)`) when you need explicit storage types, or the callback overload for pack-composed helpers (`field.text()`, `field.id.uuidv7()`, `type.sql.String(35)`).

```typescript
import { textColumn, timestamptzColumn } from '@prisma-next/adapter-postgres/column-types';
import sqlFamily from '@prisma-next/family-sql/pack';
import { uuidv4 } from '@prisma-next/ids';
import { defineContract, field, model, rel } from '@prisma-next/sql-contract-ts/contract-builder';
import postgresPack from '@prisma-next/target-postgres/pack';

const User = model('User', {
  fields: {
    id: field.generated(uuidv4()).id(),
    email: field.column(textColumn).unique(),
    createdAt: field.column(timestamptzColumn).defaultSql('now()'),
  },
}).sql({ table: 'app_user' });

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  models: { User },
});
```

Then `pnpm prisma-next contract emit`. The `field.<scalar>()` helpers (`field.text()`, `field.uuid()`, `field.id.uuidv7()`, `field.temporal.createdAt()`) are only available inside the `defineContract({...}, ({ field, ... }) => ({...}))` callback overload — outside the callback only `field.column(...)`, `field.generated(...)`, `field.namedType(...)` exist.

## Workflow — Add an extension-typed scalar (pgvector)

The concept: an extension contributes a namespace (`pgvector.*`) plus a pack descriptor. Register the pack in *both* `defineConfig.extensionPacks` (control descriptor, array form) and — for the TS builder — `defineContract.extensionPacks` (pack descriptor, record form). Then reference the namespaced constructor from the contract.

`prisma-next.config.ts`:

```typescript
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import { defineConfig } from '@prisma-next/cli/config-types';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import pgvector from '@prisma-next/extension-pgvector/control';
import { prismaContract } from '@prisma-next/sql-contract-psl/provider';
import postgres from '@prisma-next/target-postgres/control';

export default defineConfig({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensionPacks: [pgvector],
  contract: prismaContract('./src/contract.prisma', {
    output: 'src/contract.json',
    target: postgres,
  }),
});
```

`src/contract.prisma`:

```prisma
model Document {
  id        Int                          @id @default(autoincrement())
  content   String
  embedding pgvector.Vector(length: 1536)
}
```

Emit. The named-type lowering puts `vector(1536)` on the column and the type map in `contract.d.ts` carries the right TS type.

If you reference `pgvector.*` without registering the pack in the config, emit fails with `PN-CLI-4011` and `meta.missingExtensionPacks: ['pgvector']`.

## Workflow — Polymorphism (`@@discriminator` / `@@base`)

The concept (SQL targets): one base model declares the discriminator field; each variant model declares its base + discriminator value. The variant chooses STI vs MTI by **whether it sets `@@map(...)`**: no `@@map` means the variant inherits the base's table (single-table inheritance); `@@map("variant_table")` means the variant gets its own table joined 1:1 by primary key (multi-table inheritance).

```prisma
model Task {
  id    Int    @id @default(autoincrement())
  title String
  type  String

  @@discriminator(type)
  @@map("tasks")
}

// STI variant — shares the `tasks` table.
model Bug {
  severity String

  @@base(Task, "bug")
}

// MTI variant — joins to `tasks` via PK; carries its own `features` table.
model Feature {
  priority Int

  @@base(Task, "feature")
  @@map("features")
}
```

Verify the polymorphism syntax against the interpreter tests if in doubt: `packages/2-sql/2-authoring/contract-psl/test/interpreter.polymorphism.test.ts`.

Mongo has no schema layer, so polymorphism on Mongo is modelled by an explicit `discriminator` field on the model in the TS builder (see `@prisma-next/mongo-contract-ts/contract-builder`); `@@base` / `@@discriminator` PSL attributes are SQL-only.

Querying the variants is a runtime concern — see `prisma-next-queries`.

## Workflow — Brownfield introspection

The concept: pull a contract source out of an existing database and continue from there. `prisma-next contract infer --db <url>` reads the live schema and writes a `contract.prisma` file. It stops there — follow it with `contract emit` and (when the schema matches a pinned hash) `db sign` as separate steps.

```bash
pnpm prisma-next contract infer --db $DATABASE_URL --output ./src/contract.prisma
pnpm prisma-next contract emit
```

## Common Pitfalls

1. **Forgetting to re-emit after an edit.** `contract.json` and `contract.d.ts` go stale; downstream typecheck and `migration plan` see the old shape. Re-emit, or install the Vite plugin (`prisma-next-build`).
2. **Editing the emitted artefacts.** `contract.json` and `contract.d.ts` are emitted; edits there round-trip away on the next emit. Edit the source.
3. **Wrong factory/import path for the TS builder.** `defineContract`, `field`, `model`, `rel` come from `@prisma-next/sql-contract-ts/contract-builder` (or `@prisma-next/mongo-contract-ts/contract-builder`). Outside the callback overload, the available field constructors are `field.column(...)`, `field.generated(...)`, `field.namedType(...)`.
4. **`PN-CLI-4011` from a missing pack.** A namespaced constructor (`pgvector.Vector(...)`, `cipherstash.EncryptedString(...)`) requires the matching descriptor in `extensionPacks` of `defineConfig({...})`. The fix in the envelope text says "extensions"; the actual config field is `extensionPacks`.
5. **Renaming a field and expecting the planner to detect it.** Prisma Next has no in-contract rename hint; the planner sees a destructive drop+add. Hand-edit `migration.ts` after `migration plan` (see `prisma-next-migrations`), or use the keep-then-drop two-migration pattern.

## What Prisma Next doesn't do yet

- **In-contract rename hint.** No `@@rename(old: ..., new: ...)` or similar. Use the workarounds in *Common Pitfalls* #5. To request first-class rename, file via `prisma-next-feedback`.
- **Model validations.** No declarative `@validates(...)` surface. Validate in application code (arktype). To request declarative validations in the contract, file via `prisma-next-feedback`.
- **Lifecycle callbacks** (`beforeSave`, `afterCreate`, etc.). Not supported. Use middleware (`prisma-next-runtime`) or app code. To request lifecycle callbacks, file via `prisma-next-feedback`.
- **Soft delete / `paranoid: true`.** No built-in soft-delete column. Add a nullable `deletedAt DateTime?` and filter explicitly in queries (or in middleware). To request built-in soft delete, file via `prisma-next-feedback`.
- **Scopes / default filters.** No ActiveRecord-style scopes. Compose query helpers yourself. To request scopes, file via `prisma-next-feedback`.
- **Composite / embeddable types on SQL.** PSL parses `type Foo { ... }` syntax but the SQL interpreter does not lower it to composite types or JSON columns. Use a separate model + relation, or a `Json` column with application-side schemas. To request first-class composite types, file via `prisma-next-feedback`.
- **Implicit Prisma-ORM many-to-many.** List navigation on both sides without an explicit join model is rejected. Author the join model explicitly. To request implicit M2M, file via `prisma-next-feedback`.

## Reference

- Run `pnpm prisma-next contract --help` for the live command surface.
- PSL feature surface and what the interpreter accepts: `packages/2-sql/2-authoring/contract-psl/README.md`.
- TS builder surface and the callback-helper vocabulary: `packages/2-sql/2-authoring/contract-ts/README.md`.
- Per-package layout convention (where `contract.prisma`, `contract.json`, `contract.d.ts`, `migrations/` live): `.cursor/rules/contract-space-package-layout.mdc`.

## Checklist

- [ ] Read `prisma-next.config.ts` and identified the contract source provider (`prismaContract` vs `typescriptContract`) and the installed `extensionPacks`.
- [ ] Edited the contract source (`contract.prisma` or `contract.ts`), not an emitted artefact.
- [ ] For new extension namespaces: added the package, imported its control descriptor, added it to `extensionPacks` in `defineConfig({...})` (and to `defineContract({extensionPacks: {...}})` if using the TS builder).
- [ ] For renames: hand-edited `migration.ts` after `migration plan` (or used the keep-then-drop two-migration pattern) — Prisma Next has no rename hint today.
- [ ] Ran `pnpm prisma-next contract emit` after the edit (or let the Vite plugin re-emit on save).
- [ ] Confirmed `contract.json` and `contract.d.ts` updated next to the source.
- [ ] Did **not** hand-edit `contract.json` / `contract.d.ts`.
- [ ] Did **not** confabulate a missing feature (validations, callbacks, soft delete, scopes, in-contract rename hint, composite types) — referred the user to *What Prisma Next doesn't do yet* + `prisma-next-feedback`.
