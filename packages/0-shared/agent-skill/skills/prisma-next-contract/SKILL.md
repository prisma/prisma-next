---
name: prisma-next-contract
description: Edit the Prisma Next data contract — add models, fields, relations, indexes, enums, type aliases, value objects, polymorphic types (STI / MTI on SQL), install extensions. Use for schema, models, fields, attributes, validations, callbacks, soft delete, paranoid, scopes, polymorphism, discriminator, prisma schema, PSL, contract.ts, contract emit, prisma-next.config.ts, extensionPacks, pgvector, cipherstash.
---

# Prisma Next — Contract Authoring

> **Edit your data contract. Prisma handles the rest.**

The data contract is the single source of truth for your data layer. You edit it; the framework handles types, migrations, queries, and runtime configuration. The three-step user model:

1. **You edit your data contract.**
2. **The system plans the migrations for you.**
3. **If you need data migrations, you edit `migration.ts` and execute it.**

Behind step 1 is an emission step the agent owns on the user's behalf — `prisma-next contract emit` regenerates `contract.json` (runtime IR) and `contract.d.ts` (types) from the contract source. The user does not need to think about it; the agent runs it after every contract edit (or installs the Vite plugin so the bundler runs it; see `prisma-next-build`).

This skill covers step 1: every authoring operation on the contract, plus configuring extensions in `prisma-next.config.ts`.

## When to Use

- User wants to add, change, or remove a model / field / relation.
- User wants to add an index, unique constraint, or enum.
- User wants to use a custom type from an extension (`pgvector.Vector(1536)`, `cipherstash.EncryptedText`).
- User wants to install or configure an extension.
- User is migrating between authoring modes (PSL ↔ TypeScript).
- User mentions: *schema, fields, models, attributes, validations, callbacks, scopes, soft delete, paranoid, prisma schema, PSL, contract.ts, contract emit, extensionPacks, pgvector, cipherstash*.

## When Not to Use

- User wants to apply a contract change to the DB → `prisma-next-migrations`.
- User wants to write a query against the contract → `prisma-next-queries`.
- User wants to wire `db.ts` → `prisma-next-runtime`.
- User wants to set up PN for the first time → `prisma-next-quickstart`.

## Key Concepts (before any workflow)

- **Contract source** lives at the path declared in `prisma-next.config.ts` under `contract.path` (often `prisma/schema.psl` or `prisma/contract.ts`). Read the config first; do not assume the path.
- **Emit step** generates `contract.json` (runtime IR) and `contract.d.ts` (types) from the contract source. Run `prisma-next contract emit` after every contract edit (or rely on the Vite plugin to run it on save; see `prisma-next-build`). The user does not need to invoke emit directly — the agent runs it.
- **Extensions** add new type families, namespaces, and capabilities (e.g. `pgvector`, `cipherstash`). They're installed via `extensionPacks: [...]` in `prisma-next.config.ts` and referenced from the contract by their namespace (`pgvector.Vector(1536)`).
- **Type maps** are the bridge between the contract's logical types and the user's TypeScript types. Emitted into `contract.d.ts`.

## Workflow — Read the config first

Every workflow in this skill starts with:

1. Read `prisma-next.config.ts`.
2. Note: `target` (postgres / mongo), `contract.authoring` (psl / typescript), `contract.path`, `extensionPacks` (installed extensions).
3. Open the contract source at `contract.path`.

If `prisma-next.config.ts` is missing, route to `prisma-next-quickstart`.

## Add a model (PSL)

```prisma
// prisma/schema.psl
model Profile {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  createdAt DateTime @default(now())
}
```

Then:

```bash
pnpm prisma-next contract emit
```

## Add a model (TypeScript builder)

```typescript
// prisma/contract.ts
import { defineContract, model, field } from '@prisma-next/postgres/authoring';

export const contract = defineContract({
  models: {
    Profile: model({
      id: field.int().id().autoincrement(),
      email: field.string().unique(),
      createdAt: field.datetime().default('now'),
    }),
  },
});
```

Then `pnpm prisma-next contract emit` to regenerate the artifacts.

## Edit a field — rename

Prisma Next does not yet have a rename hint. When you rename a field in the contract, the planner sees the old column drop and the new column add as two unrelated operations: `migration plan` produces a destructive `DROP COLUMN` + `ADD COLUMN`. There is no in-contract way to tell the planner *"this is a rename, preserve the data"* today.

Workarounds, in order of preference:

1. **Hand-edit `migration.ts` after `migration plan`** so the destructive op becomes a `RENAME COLUMN` (or `RENAME TABLE`). Then run `node migrations/<dir>/migration.ts` to self-emit and `migration apply`. See `prisma-next-migrations` for the hand-edit workflow.
2. **Keep the old field, add the new field, backfill in `migration.ts`, then drop the old field in a follow-up migration.** Safer for production, two deploys instead of one.

If you want a first-class rename hint (e.g. `@@rename(old: "email", new: "emailAddress")` or similar), file a feature request via the `prisma-next-feedback` skill.

## Add a relation

Declare the relation on the owning side (the model that holds the FK column). Prisma Next adds the back-reference (`posts Post[]` on `User`) automatically — there is no need to write it by hand.

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
}
```

After emit, the back-reference is available on the type side and in the ORM (`db.orm.User.posts.*`). Specify cascade behaviour explicitly via `onDelete` on the owning side — the default is `Restrict`.

## Add a unique constraint or index

```prisma
model User {
  id    Int    @id @default(autoincrement())
  email String @unique               // single-field unique
  name  String

  @@unique([email, name])           // composite unique
  @@index([name])                    // non-unique index for lookups
}
```

## Add an enum

```prisma
enum Role {
  ADMIN
  USER
  GUEST
}

model User {
  id   Int  @id @default(autoincrement())
  role Role @default(USER)
}
```

## Add an extension-typed scalar (e.g. pgvector)

1. Add the extension to `prisma-next.config.ts`:

   ```typescript
   import { definePnConfig } from '@prisma-next/postgres/config';
   import { pgvectorPack } from '@prisma-next/postgres-extension-pgvector';

   export default definePnConfig({
     target: 'postgres',
     contract: { path: 'prisma/schema.psl', authoring: 'psl' },
     extensionPacks: [pgvectorPack],
   });
   ```

2. Use the namespace in the contract:

   ```prisma
   model Document {
     id        Int                       @id @default(autoincrement())
     content   String
     embedding pgvector.Vector(1536)
   }
   ```

3. Emit. The type map in `contract.d.ts` now carries the right TS type for `embedding`.

## Add a custom embeddable / value object

```prisma
type Address {
  street  String
  city    String
  zip     String
}

model User {
  id      Int     @id @default(autoincrement())
  email   String  @unique
  address Address
}
```

For MongoDB, this is a nested document. For Postgres, this is a composite type or JSON column depending on extensions.

## Add a polymorphic type (`@@discriminator` / `@@base`)

For SQL targets, Prisma Next supports two layouts for a polymorphic type with shared and per-variant fields:

- **Single-table polymorphism (STI)** — all variants share one underlying table, discriminated by a column.
- **Multi-table polymorphism (MTI)** — the base table holds shared columns, per-variant tables hold variant-specific columns and join 1:1 to the base by primary key.

The contract uses `@@base` + `@@discriminator` for both; the variant chooses the layout.

```prisma
model Animal {
  id   Int    @id @default(autoincrement())
  name String

  @@discriminator(kind: String)
  @@base
}

model Dog {
  breed String

  @@base(Animal)
  @@discriminator(kind: "dog")
}

model Cat {
  indoor Boolean

  @@base(Animal)
  @@discriminator(kind: "cat")
}
```

Queries through `db.orm.Dog` / `db.orm.Cat` return the right variant-typed row; `db.orm.Animal` returns the union. Cross-target note: MongoDB has no schema layer to model polymorphism — variants are just documents whose shape differs by field. On Mongo, model the variants directly (or with a `kind` discriminator field in application code) instead of using `@@base` / `@@discriminator`.

## Install an extension

1. Install the npm package: `pnpm add @prisma-next/<extension>`.
2. Import the extension pack and add it to `extensionPacks` in `prisma-next.config.ts`.
3. Emit. Any new namespaces (e.g. `pgvector.*`) are now available in PSL.

If the user references a namespace that isn't installed, emit fails with a structured error naming the namespace and the `extensionPacks` field where to add it.

## Decision: PSL vs TS builder vs no-emit TS-first

| Use case | Choose | Why |
|---|---|---|
| Standard project, single contract | **PSL** | Concise, familiar, well-supported. |
| Programmatic composition (per-tenant variants, generated fields) | **TS builder** | Authoring API is TypeScript. |
| Skip the emit step entirely | **No-emit TS-first** | Import the contract object straight from `contract.ts`. |

## No-emit TS-first

"No-emit" literally means **don't run `contract emit`** and **don't read `contract.json` / `contract.d.ts`**. Author the contract in TypeScript and import the contract object directly from `contract.ts` everywhere you'd otherwise import the emitted artifacts:

```typescript
import { contract } from './prisma/contract';
import postgres from '@prisma-next/postgres/runtime';

const db = postgres({ contract, url: process.env['DATABASE_URL']! });
```

Trade-offs:

- **Pros**: no emit step, no committed `contract.json`, types track edits to `contract.ts` as fast as `tsc --watch` updates them.
- **Cons**: no `contract.json` for tools that consume it (CLI inspection, migration plan, runtime contract-hash verification). Anything that needs the contract IR — `prisma-next migration plan`, `prisma-next db verify`, structured-error capability gating at runtime — still needs you to emit.

The auto-emit-on-save flow (Vite plugin) is a *separate* concept — that one still emits, just on a bundler schedule rather than a manual command. If you're using Vite, install the plugin (see `prisma-next-build`); there is no reason not to.

## Common Pitfalls

1. **Forgetting to emit after an edit.** Types and `contract.json` go stale; the type-checker either misses the new model or flags it as missing. Re-emit (or use the Vite plugin — see `prisma-next-build`).
2. **Editing `contract.json` or `contract.d.ts` directly.** Both are emitted artifacts. Edit the source (`schema.psl` / `contract.ts`), not the artifacts.
3. **Renaming a field and expecting the planner to detect it.** PN doesn't have a rename hint today; the planner sees a destructive drop+add. Hand-edit `migration.ts` after `migration plan` (see *Edit a field — rename* above and `prisma-next-migrations`).
4. **Adding an extension namespace before installing the pack.** Emit fails with "unrecognized namespace". Install the pack and add it to `extensionPacks` first.

## What Prisma Next doesn't do yet

- **Model validations.** Prisma Next doesn't do `email: string @validates(format: 'email')` for you. Validate in application code with arktype or zod. If you need declarative validations in the contract, file a feature request via the `prisma-next-feedback` skill.
- **Lifecycle callbacks** (`beforeSave`, `afterCreate`, etc.). Prisma Next doesn't run hooks on model writes. Use middleware (`prisma-next-runtime`) or app code. If you need first-class lifecycle callbacks, file a feature request via the `prisma-next-feedback` skill.
- **Soft delete / `paranoid: true`.** Prisma Next doesn't ship a built-in soft-delete column. Add a `deletedAt DateTime?` column and filter `.where(m => m.deletedAt.isNull())` in your queries (or in a middleware). If you need built-in soft delete, file a feature request via the `prisma-next-feedback` skill.
- **Scopes / default filters.** Prisma Next doesn't have ActiveRecord- style scopes. Compose query builders yourself (e.g. a `published()` helper that returns `db.orm.Post.where(p => p.status.eq('published'))`). If you need scopes built-in, file a feature request via the `prisma-next-feedback` skill.

## Reference Files

- `references/psl-quick-reference.md` — PSL field types, attributes, modifiers.
- `references/ts-authoring-quick-reference.md` — TS builder API.
- `references/extension-namespaces.md` — installed-extension namespaces and the field types each provides.

## Checklist

- [ ] Read `prisma-next.config.ts` and identified target + authoring mode + extensionPacks.
- [ ] Edited the contract source (`schema.psl` or `contract.ts`), not an emitted artifact.
- [ ] For renames: hand-edited `migration.ts` (or used the keep-then-drop two-migration pattern) — PN has no rename hint today.
- [ ] For new extension namespaces: installed the package, added to `extensionPacks`, then used the namespace.
- [ ] Ran `prisma-next contract emit` after the edit (or let the Vite plugin re-emit on save).
- [ ] Confirmed `contract.json` and `contract.d.ts` updated.
- [ ] Type-checked any code that depends on the new/changed models.
- [ ] Did NOT hand-edit `contract.json` / `contract.d.ts`.
- [ ] Did NOT silently confabulate a missing feature (validations, callbacks, soft delete, scopes, in-contract rename hint) — referred user to the capability-gap section + feature-request URL.
