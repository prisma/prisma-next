---
name: prisma-next-contract
description: Edit the Prisma Next data contract — add models, fields, relations, indexes, enums, type aliases, value objects, inheritance, install extensions. Use for schema, models, fields, attributes, validations, callbacks, soft delete, paranoid, scopes, prisma schema, PSL, contract.ts, contract emit, prisma-next.config.ts, extensionPacks, pgvector, cipherstash.
---

# Prisma Next — Contract Authoring

> **Edit your data contract. Prisma handles the rest.**

The data contract is the single source of truth for your data layer. You edit it; the framework handles types, migrations, queries, and runtime configuration. The three-step user model:

1. **You edit your data contract.**
2. **The system plans the migrations for you.**
3. **If you need data migrations, you edit `migration.ts` and execute it.**

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
- **Emit step** generates `contract.json` (runtime IR) and `contract.d.ts` (types). Run `prisma-next contract emit` after every contract edit.
- **Extensions** add new type families, namespaces, and capabilities (e.g. `pgvector`, `cipherstash`). They're installed via `extensionPacks: [...]` in `prisma-next.config.ts` and referenced from the contract by their namespace (`pgvector.Vector(1536)`).
- **Contract spaces** are how aggregate-contract monorepos work: each package owns its own `prisma-next.config.ts`, its own contract source, and its own portion of the schema. Cross-package queries route through the aggregate contract at the monorepo root.
- **Type maps** are the bridge between the contract's logical types and the user's TypeScript types. Emitted into `contract.d.ts`.

## Workflow — Read the config first

Every workflow in this skill starts with:

1. Read `prisma-next.config.ts` (the relevant one — in a monorepo, the one in the package the user is editing).
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

## Add an inheritance hierarchy (`@@discriminator` / `@@base`)

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

Single-table inheritance (STI). All three models share one underlying table; `kind` discriminates. Queries through `db.orm.Dog` and `db.orm.Cat` are typed appropriately.

## Install an extension

1. Install the npm package: `pnpm add @prisma-next/<extension>`.
2. Import the extension pack and add it to `extensionPacks` in `prisma-next.config.ts`.
3. Emit. Any new namespaces (e.g. `pgvector.*`) are now available in PSL.

If the user references a namespace that isn't installed, emit fails with a structured error naming the namespace and the `extensionPacks` field where to add it.

## Decision: PSL vs TS builder vs no-emit TS-first

| Use case | Choose | Why |
|---|---|---|
| Standard project, single contract | **PSL** | Concise, familiar, well-supported. |
| Multi-tenant per-tenant variants | **TS builder** | Programmatic composition. |
| Live-reload during dev | **No-emit (TS + Vite/Next plugin)** | Auto-emits on save. |
| Aggregate-contract monorepo | **One per package** | Each package owns its space. |

## No-emit (Vite / Next plugin)

The TypeScript authoring mode supports a "no-emit" flow where contract artifacts are derived on-demand by a build plugin, not written to disk. Configure in `vite.config.ts`:

```typescript
import { prismaNext } from '@prisma-next/vite';
export default {
  plugins: [prismaNext({ configPath: './prisma-next.config.ts' })],
};
```

Useful when you want contract edits to flow to types without a manual `contract emit`. For production builds, still run `contract emit` explicitly.

## Aggregate-contract monorepo

In an aggregate-contract monorepo, each package owns its `prisma-next.config.ts` and its slice of the contract. The application root has its own `prisma-next.config.ts` that aggregates the per-package contracts.

Workflow:

1. Identify which package the user is editing in. Read its `prisma-next.config.ts`.
2. Edit only that package's contract source. Do not touch other packages' contracts.
3. Emit from the package directory: `pnpm prisma-next contract emit`.
4. Emit at the aggregate root if you also want the aggregate `contract.d.ts` refreshed.

See [ADR 212 — Contract spaces](https://github.com/prisma/prisma-next/blob/main/docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) for the durable model.

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
