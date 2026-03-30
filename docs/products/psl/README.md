## PSL support limitations (Prisma Next, SQL PSL provider v1)

This document summarizes the **current limitations** of Prisma Next’s PSL-first contract authoring, intended for product planning and future roadmap work.

Scope: **PSL → SQL Contract IR** via `@prisma-next/psl-parser` and `@prisma-next/sql-contract-psl`.

## What PSL v1 can do today (high level)

- **Models, enums, and named types** (`types { ... }`) with deterministic parsing and span-aware diagnostics.
- **SQL storage mapping** for a Postgres-first subset: tables, columns, primary keys, uniques, indexes, and foreign keys.
- **Defaults** for a curated set of TS-aligned functions and literals, lowered into either storage defaults or execution defaults.
- **Extension-pack parity (minimal)**: `@pgvector.column(...)` when the corresponding pack is composed in config.

For package-level responsibilities and supported defaults, see:

- `packages/2-sql/2-authoring/contract-psl/README.md`
- `packages/1-framework/2-authoring/psl-parser/README.md`

## Key limitations (intentional in v1)

### PSL language constructs

- **Top-level blocks are rejected** (e.g. `datasource { ... }`, `generator { ... }`).
  - Prisma Next owns these concerns in `prisma-next.config.ts` rather than PSL.

### Types and fields

- **Scalar and storage-oriented list fields are rejected** (strict error), including:
  - **Scalar lists** like `String[]`
  - **Enum/named-type lists** (no array-column storage mapping in SQL PSL provider v1)

- **Model-typed list fields are supported only as relation navigation lists** (see “Relations” below).
  - These do not map to storage columns.
  - They are accepted only when they can be matched to an FK-side relation.
  - They are strict about attributes: only `@relation("Name")` / `@relation(name: "Name")` are allowed on the list side.

This is a deliberate “strict subset” choice: PSL v1 is bounded by the current TS authoring surface + contract model and prefers “fail loudly” over silent partial interpretation.

- **Selected Postgres native type attributes (`@db.`*) are supported on named types** for brownfield round-trips.
  - Current support covers the printer/provider subset needed to preserve native storage shape for inferred PSL: `@db.Char`, `@db.VarChar`, `@db.Numeric`, `@db.Uuid`, `@db.SmallInt`, `@db.Real`, `@db.Timestamp`, `@db.Timestamptz`, `@db.Date`, `@db.Time`, `@db.Timetz`, and `@db.Json`.
  - The extension-pack parity surface still includes `@pgvector.column(...)` when the corresponding pack is composed.
- **Typed JSON schema parameterization is unsupported** (PSL has no way to encode TS `typeParams` schema payloads in v1).

### Relations

- PSL v1 supports:
  - the **foreign-key side** of relations (`@relation(fields: [...], references: [...], onDelete?, onUpdate?)`)
  - one-to-many **navigation list fields** (`User.posts Post[]`) when they can be matched to an FK-side relation
  - relation naming via `@relation("Name")` and `@relation(name: "Name")` for disambiguation
- PSL v1 emits deterministic relation metadata in `contract.relations` for both sides of a lowered 1:N relation (FK side + navigation list side).
- PSL v1 still does **not** support implicit many-to-many (list fields on both sides without an explicit join model).
- Explicit many-to-many via a join model is supported as two 1:N relations: each FK side uses `@relation(fields: [...], references: [...])`, and matching navigation list fields can be lowered into `contract.relations` when they meet the same navigation-list constraints above.

### Defaults

- Default lowering is **strictly vocabulary-limited** (unknown defaults error).
- Supported defaults are split into:
  - **Storage defaults**: literals, `autoincrement()`, `now()`, `dbgenerated("...")`
  - **Execution defaults** (mutation-time generators): `uuid()`, `uuid(4)`, `uuid(7)`, `cuid(2)`, `ulid()`, `nanoid()`, `nanoid(n)`
- **`cuid()` (cuid v1) is explicitly unsupported**; diagnostics guide users to `cuid(2)`.
- **`dbgenerated("...")` is string-literal based** and (in v1) preserves the parsed contents as-is (escape sequences are not normalized).

### Indexes and constraints

- Indexes/uniques are supported in their simplest form (column lists), but richer Prisma ORM options are out of scope, such as:
  - named constraints/indexes
  - operator classes / index methods
  - partial/filtered indexes
  - fulltext/search-specific constructs

### Extension packs and namespacing

- PSL does **not** activate or pin extension packs.
- Namespaced attributes are only accepted when the corresponding pack is composed in `prisma-next.config.ts`.
- Beyond the initial pgvector subset, other namespaced attributes are currently strict errors.

### Capabilities and contract metadata

- PSL v1 does **not** provide a way to declare contract capabilities (e.g. the TS `.capabilities({ ... })` surface).
- PSL-first authoring focuses on producing the same canonical contract meaning for the supported subset; additional capability gating remains driven by packs/targets and the existing framework pipeline.

## Diagnostics and behavior guarantees (v1)

- **Strict errors** for unsupported constructs (no warning/best-effort mode).
- Diagnostics include **stable codes** and **source spans** suitable for CLI/editor rendering.
- Interpretation is intended to be **deterministic** for equivalent AST inputs.

## Implications for planning (common next steps)

These are recurring “next” areas implied by the above limitations:

- **Broader `@db.` parity** beyond the current brownfield round-trip subset
- **Richer index / constraint features** (names, methods, predicates) gated by target/packs
- **Tooling-friendly inline language blocks** (tagged template literals like `sql\`...`) for SQL snippets, with explicit rules (e.g. no interpolation) and parser-agnostic tag configuration

## Github Syntax Highlighting

[See the Github Linguist repo here](https://github.com/github-linguist/linguist)

If we change the PSL grammar, be sure to update the Github syntax highlighter and the Prisma Language Tools (used by the VS Code extension).
