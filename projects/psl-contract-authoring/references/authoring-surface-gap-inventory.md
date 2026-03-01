# Authoring surface gap inventory (TS + Prisma PSL)

This document exists to keep `projects/psl-contract-authoring/plans/plan.md` readable.

It records two related (but distinct) inventories:

- **TS surface gaps**: behaviors the TypeScript contract authoring surface can express that PSL cannot yet express (this is the actual “parity gap”).
- **Prisma ORM PSL surface gaps**: features in the official Prisma Schema Language that we do *not* plan to support (because Prisma Next’s capability ceiling is the TS authoring surface + contract model).

## TS surface gap inventory (not currently possible in PSL v1)

- **Parameterized column/storage types (`typeParams`)**
  - TS can express parameterized native types via descriptors or `typeParams` (e.g. `charColumn(length)`, `varcharColumn(length)`, `numericColumn(precision, scale)`, temporal precision types, etc.).
  - PSL v1 cannot express or interpret parameterized types (neither for per-field attributes nor in `types { ... }` declarations).

- **Extension packs + namespaced attributes**
  - TS can compose `extensionPacks` and author columns/types that depend on extension metadata (e.g. pgvector).
  - PSL v1 does not yet support namespaced attributes like `@pgvector.column(...)` (or any pack-provided validation/encoding).

- **More default functions**
  - TS can express additional default functions/expressions on columns beyond `autoincrement()` and `now()`.
  - PSL v1 only supports `autoincrement()` and `now()` plus literal defaults.

- **Storage mapping control**
  - TS can choose table names independently and map models to those table names explicitly.
  - PSL v1 derives table names from model names (`lowerFirst(model.name)`) and does not support `@@map` / `@map`-style mapping.

- **Constraint/index naming and richer FK configuration**
  - TS can name indexes/uniques and provide richer foreign key options (names; constraint/index flags; defaults).
  - PSL v1 supports only columns lists for `@@unique`/`@@index`, and a limited FK surface (fields/references + onDelete/onUpdate).

- **Typed JSON schema parameterization**
  - TS supports parameterizing `json/jsonb` columns with a Standard Schema payload (typeParams carrying schema JSON/type expression).
  - PSL v1 cannot encode this.

- **Generated/execution defaults**
  - TS supports generated columns / execution defaults in the contract IR.
  - PSL v1 cannot encode these.

## Prisma ORM PSL surface gaps (vs `psl-schema-reference.md`)

These are features that exist in Prisma ORM’s PSL but are either irrelevant in Prisma Next or are explicitly out of scope because they exceed the TS authoring surface.

- **Top-level blocks**
  - Prisma PSL supports `datasource { ... }` and `generator { ... }` blocks.
  - **Decision (out of scope):** Prisma Next does not use these for contract authoring; the PSL interpreter should reject them (only `model`, `enum`, `types`).

- **Native database type attributes (`@db.*`)**
  - Prisma PSL supports extensive `@db.*` attributes (including parameterized forms like `@db.VarChar(191)`, `@db.Char(n)`, etc.).
  - **Decision (in scope, SQL-only):** support a representative SQL subset (Postgres) via parameterized attributes; exclude Mongo-specific semantics and connector-specific features.

- **Mapping / naming attributes**
  - Prisma PSL supports `@map` (field → column) and `@@map` (model → table), plus `@@schema`.
  - **Decision:** `@map` and `@@map` are **in scope** (representative + “trivial”); `@@schema` is **out of scope** (not supported in TS surface either).

- **Ignore directives**
  - Prisma PSL supports `@ignore` and `@@ignore`.
  - **Decision (out of scope):** Prisma Next does not need these for contract authoring.

- **Additional model/field attributes and index features**
  - Prisma PSL supports many additional directives beyond the v1 set (for example `@updatedAt`, richer `@@index` options, `@@fulltext`, etc.).
  - **Decision (out of scope for now):** exclude connector-specific and “non-standard” features (e.g. Cockroach-only options); this is exactly what targets/extension packs should provide.

## Other notable PSL gaps (worth tracking explicitly)

- **Composite primary keys (`@@id([..])`)**
  - Prisma PSL supports `@@id` and TS authoring can express multi-column primary keys.
  - **Decision (out of scope for next week):** Prisma Next PSL v1 does not support `@@id` yet (only `@id` field attributes).

- **Bytes scalar mapping (SQL)**
  - Prisma PSL includes `Bytes` and pgvector authoring commonly builds on a byte-backed column in PSL examples.
  - Prisma Next PSL v1 currently does not include `Bytes` in the SQL scalar mapping, so even without extensions we should add it for a representative SQL subset.

- **List fields**
  - Prisma PSL supports scalar lists like `String[]` and list defaults.
  - **Decision (out of scope):** list fields are not supported by the TS authoring surface either; PSL will remain aligned to TS authoring parity and reject list fields.

