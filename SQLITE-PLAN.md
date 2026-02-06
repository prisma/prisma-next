# SQLite Support Plan (Prisma Next)

This document is a handoff plan for implementing first-class SQLite support in Prisma Next, including a duplicated SQLite demo app with all existing demo queries ported.

It is written to be executable by a coding agent with minimal additional context.

---

## Goals

1. Add a new SQL target: **SQLite**.
1. Keep the architecture contract-first and target-agnostic in core: **dialect logic stays in targets/adapters/drivers**.
1. Support a pluggable SQLite driver backend:
   - Node 24: `node:sqlite`
   - Bun: `bun:sqlite`
1. Support the existing query surface used by the demos:
   - SQL lane: `select`, `where`, joins, `limit`, `orderBy`, `includeMany`
   - DML: `insert`, `update`, `delete`, `returning()`
   - ORM lane queries in `examples/prisma-next-demo/src/queries/*`
   - Kysely integration queries in `examples/prisma-next-demo/src/kysely/*` (via `@prisma-next/integration-kysely`)
1. Duplicate `examples/prisma-next-demo` and port all queries/commands to SQLite.

## Non-Goals (Explicitly Out of Scope Unless You Decide Otherwise)

1. Perfect feature parity with Postgres across the full codebase.
1. Multi-tenant schema namespacing in SQLite beyond "one DB file per contract" (see ADR 122).
1. Optimizing for extreme concurrency (SQLite is single-writer; handle correctness first).
1. Duplicating `examples/prisma-orm-demo` for SQLite parity.

---

## Architectural Boundaries To Respect (Read These First)

### Domains / Layers / Planes

Use the repo’s layering and plane rules as the primary constraint system:

- **Framework domain** (`packages/1-framework/**`): target-agnostic core types/runtime tooling.
- **SQL family domain** (`packages/2-sql/**`): dialect-agnostic SQL lane/runtime/family tooling.
- **Targets domain** (`packages/3-targets/**`): concrete dialect packs: target descriptor, adapter, driver.
- **Extensions domain** (`packages/3-extensions/**`): optional packs (e.g. pgvector).

Key boundary rules (see `docs/architecture docs/Package-Layering.md` + `architecture.config.json`):

- No “target branches” in core: keep dialect-specific behavior out of SQL lanes/runtime.
- Migration plane must not import runtime-plane code.
- Shared plane must not import runtime/migration-plane code.

### Where SQLite Code Must Live

Implement SQLite as three packages mirroring Postgres:

- `packages/3-targets/3-targets/sqlite` → `@prisma-next/target-sqlite`
  - **Plane**: migration + runtime entrypoints
  - **Owns**: migration planner/runner for SQLite (DDL strategy, checks), target descriptor/pack ref
- `packages/3-targets/6-adapters/sqlite` → `@prisma-next/adapter-sqlite`
  - **Plane**: shared + migration + runtime entrypoints
  - **Owns**: dialect lowering, capabilities, codecs, control-plane introspection + default normalization, error normalization
- `packages/3-targets/7-drivers/sqlite` → `@prisma-next/driver-sqlite`
  - **Plane**: migration + runtime entrypoints
  - **Owns**: transport/connection to SQLite (file DB), query/execute/explain plumbing, streaming strategy

Update `architecture.config.json` to map these packages to the correct domain/layer/plane globs.

---

## What Must Change In Existing Code (Extension Points)

### 1. Marker Storage Is Currently Postgres-Specific In SQL Family Runtime

Observed:

- `packages/2-sql/5-runtime/src/sql-marker.ts` hardcodes Postgres-only DDL/types (`create schema`, `jsonb`, `timestamptz`, `now()`, `$1`).
- `packages/2-sql/5-runtime/src/sql-family-adapter.ts` uses `readContractMarker()` from the Postgres-shaped marker module for *all* SQL targets.
- `packages/2-sql/3-tooling/family/src/core/verify.ts` also hardcodes `from prisma_contract.marker where id = $1`.

Why this blocks SQLite:

- ADR 021 specifies SQLite marker lives in **`prisma_contract_marker`** (no schemas) and must use SQLite-compatible column types + SQL.

Required change (choose one approach; prefer A):

**A. Push marker SQL into adapters (recommended; matches ADR 021 + ADR 005):**

- Runtime: make SQL family runtime read marker via the **runtime adapter instance** (dialect-owned).
- Control plane: make SQL family control-plane verify/sign/readMarker use the **control adapter instance** (dialect-owned).

**B. Branch on target inside SQL family for marker only (acceptable fallback):**

- Add `if (contract.target === 'sqlite') ...` branches in SQL family runtime/control to generate target-specific marker SQL.
- This violates “thin core, fat targets” more than A; document the debt in “Architectural Challenges”.

Acceptance criteria for this workstream:

- Runtime verification works for both Postgres and SQLite contracts.
- `pnpm lint:deps` passes (no new plane violations).

Implementation notes (current repo state):

- Marker reads are adapter-owned at runtime (SQL family runtime calls an adapter hook to obtain the marker read statement).
- Control-plane marker DDL/reads are target-aware to support SQLite’s flat namespace marker table.

### 2. includeMany Gating Uses `lateral` + `jsonAgg`

Observed:

- SQL lane gates `includeMany()` on `contract.capabilities[contract.target].lateral === true` and `jsonAgg === true` (`packages/2-sql/4-lanes/sql-lane/src/utils/capabilities.ts`).
- Postgres implements includeMany via `LEFT JOIN LATERAL ... json_agg(...)`.

SQLite reality:

- SQLite does **not** have `LATERAL`, but *can* implement includeMany using correlated subqueries plus JSON aggregation (JSON1) if available.

Required change:

- Either:
  - Keep the existing capability keys but reinterpret `lateral` as “supports includeMany strategy” (not ideal; document it).
  - Or introduce a new capability key (recommended), e.g. `includeMany: true`, and update lane gating + docs accordingly.

Acceptance criteria:

- `includeMany()` works on SQLite demo queries and returns `[]` for no children (see `decodeRow()` behavior in `packages/2-sql/5-runtime/src/codecs/decoding.ts`).

Implementation notes (current repo state):

- We kept the existing gating keys for now and set `capabilities.sqlite.lateral = true` and `capabilities.sqlite.jsonAgg = true` on the SQLite demo contract so `includeMany()` is enabled.
- SQLite lowering implements includeMany via a correlated subquery plus JSON1 (`json_group_array/json_object`).

### 3. Control-Plane Introspection Must Be Implemented For SQLite

Observed:

- SQL family control instance delegates introspection to the adapter’s `SqlControlAdapter.introspect()` implementation (Postgres exists).

Required:

- Add `SqliteControlAdapter` in `@prisma-next/adapter-sqlite`:
  - tables: `sqlite_master`
  - columns: `pragma_table_info`
  - indexes: `pragma_index_list` + `pragma_index_info`
  - foreign keys: `pragma_foreign_key_list`
  - defaults: use `dflt_value` and implement `parseSqliteDefault` normalization

Acceptance criteria:

- `prisma-next db introspect` and `db schema-verify` work with SQLite demo DB.

Implementation notes (current repo state):

- SQLite introspection normalizes `nativeType` to lower-case (`INTEGER` → `integer`) to match contract native types.
- SQLite introspection excludes target-owned control tables (`prisma_contract_marker`, `prisma_contract_ledger`) so strict schema verification does not fail on internal tables.

### 4. Migration Planner/Runner For SQLite Must Exist (At Least For “db init”)

You need a `@prisma-next/target-sqlite` planner/runner analogous to Postgres:

- Planner: additive-only init planner (empty DB → contract schema)
  - SQLite DDL limitations: ALTER TABLE is limited; prefer “init from empty DB” as MVP.
- Runner: execute plan, verify schema, write marker + ledger (SQLite-flavored tables).
- Locks: SQLite has no advisory locks (ADR 043). Either implement lease table lock for correctness or document the limitation explicitly.

Acceptance criteria:

- The duplicated SQLite demo can run end-to-end: init DB, seed, execute queries.

Documentation requirement:

- Add `SQLITE_MIGRATIONS.md` describing the additive-only MVP and a concrete future strategy for non-additive diffs (table rebuild).

### 5. Driver: Implement SQLite Transport (Runtime + Control)

Add `@prisma-next/driver-sqlite`:

- Control driver (`./control`): implements `ControlDriverInstance<'sql','sqlite'>` with `query()`.
- Runtime driver (`./runtime`): implements `SqlDriver` with:
  - `connect()`
  - `acquireConnection()` / `beginTransaction()` / commit/rollback
  - `execute()` as `AsyncIterable` (chunked iteration is fine; see ADR 125)
  - optional `explain()` (SQLite `EXPLAIN QUERY PLAN ...`)

Chosen in this repo (current state):

- Support both:
  - Node 24’s built-in `node:sqlite` module (`DatabaseSync`)
  - Bun’s `bun:sqlite`
- Work around bundlers that strip `node:` prefixes by loading the module via `createRequire()` with a runtime-built specifier (see `packages/3-targets/7-drivers/sqlite/src/node-sqlite.ts`).
- Raw SQL lane `$1` placeholders are normalized to SQLite `?1` placeholders in the SQLite driver.
- Prisma-style `file:./dev.db` connection strings must be resolved relative to `process.cwd()` (the URL constructor is not sufficient).

### 6. Adapter: Implement SQLite Lowering + Codecs

Add `@prisma-next/adapter-sqlite`:

- Capabilities: at minimum: `orderBy`, `limit`, `returning`, `jsonAgg` (if JSON1), and whatever you decide for includeMany gating.
- Lowering:
  - Identifiers quoted with `"` (SQLite compatible).
  - Params: prefer `?{n}` placeholders (ADR 065 baseline).
  - SELECT: joins/where/order/limit.
  - includeMany: correlated subquery producing JSON array string:
    - `SELECT (SELECT json_group_array(json_object(...)) FROM child WHERE ... ORDER BY ... LIMIT ...) AS posts`
  - DML: INSERT/UPDATE/DELETE with `RETURNING` when capability is enabled.
- Codecs:
  - int → number
  - text → string
  - datetime/timestamp → string (or Date, but be consistent; Postgres demo currently treats timestamp codecs as string)
  - bool: store as integer 0/1 (encode/decode)

### 7. Kysely Integration Must Support SQLite

The native demo includes a Kysely example (`examples/prisma-next-demo/src/kysely/*`) using
`@prisma-next/integration-kysely`. Porting the demo to SQLite therefore requires SQLite support
in the Kysely integration extension.

Required change:

- Extend `packages/3-extensions/integration-kysely` so `KyselyPrismaDialect` supports `contract.target === 'sqlite'`:
  - Use Kysely’s SQLite dialect primitives (`SqliteAdapter`, `SqliteIntrospector`, `SqliteQueryCompiler`).
  - Ensure the runtime driver’s placeholder strategy works with Kysely (SQLite uses `?`/`?1` placeholders).

Acceptance criteria:

- SQLite demo commands `user-kysely` and `user-transaction-kysely` work end-to-end.

### 8. Duplicate Demo Apps + Port Queries

Create new example(s) under `examples/`:

1. `examples/prisma-next-demo-sqlite/` (native lane demo)

Porting tasks:

- New `prisma-next.config.ts` using sqlite target/adapter/driver and a SQLite connection string (likely a file path).
- New contract definition using sqlite column types and `@prisma-next/target-sqlite/pack`.
- Update runtime factory to use sqlite driver options.
- Seed script:
  - If you cannot support vector similarity in SQLite, you must still “port” the query by either:
    - Implementing a SQLite vector extension pack (preferred), or
    - Replacing similarity search with a SQLite-available operation and documenting the semantic change.

Important: “Port all queries” means every demo query module has a SQLite equivalent and runs:

- `examples/prisma-next-demo/src/queries/*.ts`
- `examples/prisma-next-demo/src/kysely/*.ts` (requires `@prisma-next/integration-kysely` SQLite support)

Implementation notes (current repo state):

- `examples/prisma-next-demo-sqlite/` exists and has all demo queries ported.
- Vector similarity is supported via `@prisma-next/extension-sqlite-vector` (stores vectors as JSON text) plus a SQLite UDF (`cosine_distance`) registered by the demo runtime.

### 9. Tests

Add SQLite-focused tests at three levels:

- Package tests:
  - `@prisma-next/adapter-sqlite`: lowering golden tests (AST → SQL), includeMany SQL shape tests.
  - `@prisma-next/driver-sqlite`: execute/query/transaction behavior tests.
  - `@prisma-next/target-sqlite`: planner/runner unit tests.
- Example tests:
  - Copy `examples/prisma-next-demo/test/*` patterns but use a SQLite temp DB file fixture instead of `withDevDatabase`.
- Integration/e2e:
  - Add at least one CLI test covering `db init` and `db verify` on SQLite.

---

## Concrete Implementation Steps (Recommended Order)

1. Scaffold packages:
   - `@prisma-next/target-sqlite`
   - `@prisma-next/adapter-sqlite`
   - `@prisma-next/driver-sqlite`
   - Wire `architecture.config.json` mappings
   - Add `tsconfig` references (see `tsconfig.base.json` pattern)
1. Implement `@prisma-next/driver-sqlite` (runtime + control).
1. Implement `@prisma-next/adapter-sqlite`:
   - codecs
   - lowering for select/join/where/order/limit
   - DML + returning
   - includeMany lowering strategy
   - control adapter introspection + default normalization
1. Fix marker plumbing to support both Postgres and SQLite (prefer adapter-owned marker statements).
1. Implement `@prisma-next/target-sqlite` migrations init planner/runner.
1. Duplicate `examples/prisma-next-demo` → `examples/prisma-next-demo-sqlite` and port:
   - contract
   - config
   - runtime wiring
   - seed
   - queries
1. Add tests and make `pnpm test:packages` + `pnpm test:examples` green.
1. Update docs:
   - `docs/reference/capabilities.md` (ensure it matches actual capability namespaces/keys)
   - Add a short `packages/3-targets/**/sqlite/README.md` trilogy similar to Postgres.

---

## Architectural Challenges (Write This As You Implement)

As you implement, maintain a running list under this section (in this file or a PR description) of architectural problems you encounter, with:

1. The exact file(s) involved
1. What boundary/ADR/rule it violates or stresses
1. The minimal viable fix
1. The “correct” long-term fix
1. Any rule/doc updates required

You should expect at least these issues to come up:

- SQL marker code (`packages/2-sql/5-runtime/src/sql-marker.ts`) is Postgres-only but lives in SQL family runtime.
- SQL family tooling core is mapped as “shared plane” but currently imports runtime code (`@prisma-next/sql-runtime`) in `packages/2-sql/3-tooling/family/src/core/control-instance.ts`.
- Capability namespaces/keys in code vs `docs/reference/capabilities.md` diverge (code uses `contract.capabilities[contract.target]` with keys like `lateral`, not `sql.lateral`).
- includeMany capability key (`lateral`) does not generalize to SQLite’s correlated-subquery implementation.
- `node:sqlite` is only available under the `node:` scheme, but some bundlers strip `node:` prefixes in output. The SQLite driver must avoid static imports from `node:sqlite` or compensate.
- `bun:sqlite` differs from `node:sqlite` in parameter binding semantics. In particular, Bun supports positional binding for `?1` placeholders, while Node requires numeric binding objects; the driver must implement backend-specific binding behavior.
- `bun:sqlite` does not support registering JS UDFs in the same way as `node:sqlite`. Avoid designs that require UDF registration for core/demo functionality (e.g. prefer pure SQL lowerings for extension packs when feasible).
- Prisma-style SQLite connection strings like `file:./dev.db` are not valid standard file URLs. Do not rely on `new URL()` to resolve them; resolve relative paths against `process.cwd()`.
- SQLite has no schema namespace, so strict schema verification must ignore target-owned control tables (`prisma_contract_*`) or they will be reported as “extra tables”.

If you decide rules must change:

- List the exact `.cursor/rules/*.mdc` file(s) and the minimal change.
- Update the corresponding docs/ADR references where appropriate.
