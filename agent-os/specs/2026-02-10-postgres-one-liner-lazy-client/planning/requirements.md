## Requirements

### Initial description

Create a **Drizzle-like one-liner** for Postgres projects that returns a **lazy client**.

Key constraints:

- The client must allow loading **static context** without initializing runtime / without connecting to DB at import-time.
- The implementation must internally compose existing primitives:
  - `createSqlExecutionStack`
  - `instantiateExecutionStack`
  - `createExecutionContext`
  - `createRuntime`
  - Postgres target/adapter/driver descriptors
- Fix architecture layering: `validateContract()` should live in **shared-plane** code and be consumable from runtime helpers (currently in `@prisma-next/sql-contract-ts`).
- Stay aligned with **TML-1837** (decouple driver instantiation from connection binding). The one-liner may accept `url` as sugar, but must structurally model binding separately.

### Acceptance criteria

- Provide an app-facing helper with this shape:
  - `import postgres from '@prisma-next/postgres/runtime'`
  - `const db = postgres<Contract>({ contractJson, url, extensions, plugins })` (emitted-contract workflow)
  - `const db = postgres({ contract, url, extensions, plugins })` (no-emit / TS-authored contract workflow)
- The returned `db` exposes at least:
  - `db.sql`, `db.schema`, `db.orm` (static query roots)
  - `db.context` (execution context)
  - `db.stack` (execution stack / descriptors used)
  - `db.runtime(): Runtime` (lazy constructor; memoized)
- Lazy semantics:
  - Calling `postgres(...)` performs **no runtime instantiation** and **no driver/pool creation**.
  - The first call to `db.runtime()` is the trigger that creates the runtime (and any driver/pool).
- Contract validation:
  - If `contractJson` is provided, the helper validates it internally via `validateContract<TContract>(contractJson)`.
  - `validateContract()` is shared-plane code; runtime helpers do not depend on migration-plane packages.
- Demo validation:
  - The demo app configuration collapses to **one file** with **one helper function call**.

### Related work / dependencies

- [TML-1837](https://linear.app/prisma-company/issue/TML-1837/runtime-dx-decouple-runtime-driver-instantiation-from-connection) — decouple driver instantiation from connection binding (the helper must remain compatible with this direction)

### Requirements discussion

#### First round questions

1) Public API shape: `postgres` default export from `@prisma-next/postgres/runtime`.
2) Return surface: `{ sql, schema, orm, runtime, context, stack }` is sufficient.
3) Location: expose the app helper from `@prisma-next/postgres/runtime` (composition layer above targets/adapters/drivers).
4) Contract inputs: accept either `contractJson` (validated internally) or `contract`.
5) Breaking changes: preferred; do not add backward compatibility shims.
6) Lazy trigger: runtime created on first call to `runtime()`.
7) Pool/driver timing: defer pool/driver creation until runtime is created.
8) Binding options: support `url` and `pg` `Pool`/`Client` forms (no additional binding models in MVP).
9) Overrides: KISS; no stack override knobs in MVP.
10) Packaging: new package `@prisma-next/postgres` composes other packages; update earlier “export from target-postgres” idea accordingly.
11) Testing: minimal; primary validation is demo DX improvement (one file, one function call).

#### Follow-up questions

- None required.

### Scope boundaries

**In scope:**

- New package `@prisma-next/postgres` that composes:
  - Postgres target descriptor
  - Postgres adapter descriptor
  - Postgres driver descriptor / driver factory
  - SQL runtime primitives (`createSqlExecutionStack`, `createExecutionContext`, `instantiateExecutionStack`, `createRuntime`)
- App-facing runtime entrypoint `@prisma-next/postgres/runtime` exporting `postgres` helper (default export).
- Extract/move `validateContract()` into shared-plane code and update call sites to use the new import path (breaking change, no shims).
- Update demo to use the helper and achieve the one-file/one-call configuration.

**Out of scope:**

- Full TML-1837 driver lifecycle refactor (the helper should be compatible with that future direction, but not implement it here).
- Cross-target generic “one-liner” helpers (Postgres only for MVP).
- A broad test suite beyond minimal smoke/usage validation in the demo.

### Visual assets

- None.
