# Tasks — Postgres one-liner lazy client

Date: 2026-02-10  
Spec: `agent-os/specs/2026-02-10-postgres-one-liner-lazy-client/spec.md`

Principles:
- **KISS**: minimal tests; **demo is primary validation**
- **Breaking changes allowed**: no backward-compat shims for `validateContract` relocation
- **Lazy runtime**: no runtime/driver/pool work until `db.runtime()`

---

## Milestone 0 — Tracking + alignment

1. [x] Create a Linear issue for this spec (link it from `spec.md` “Linear” line). (`TML-1891`)
2. [x] Confirm scope boundaries match TML-1837 direction (binding modeled structurally; `url` remains sugar). (Captured in `spec.md` under “Binding model and TML-1837 alignment”.)

---

## Milestone 1 — Relocate `validateContract()` to shared-plane `@prisma-next/sql-contract` (breaking)

### Add new shared export path

1. [x] Implement `validateContract` in shared-plane package:
   - **Package**: `packages/2-sql/1-core/contract` (`@prisma-next/sql-contract`)
   - **New entrypoint**: `src/exports/validate.ts` exporting `validateContract<TContract extends SqlContract<SqlStorage>>(value: unknown): TContract`
   - **Wire exports**: add `./validate` entry to `packages/2-sql/1-core/contract/package.json` `exports`
2. [x] Ensure shared `validateContract` does not introduce new dependency cycles (keep deps inside `@prisma-next/sql-contract` + `arktype`).

### Repo-wide callsite update (explicit breaking change)

3. [x] Update imports from:
   - **Old**: `@prisma-next/sql-contract-ts/contract`
   - **New**: `@prisma-next/sql-contract/validate`
4. [x] Touch points (non-exhaustive; verify with repo-wide search):
   - **Examples**
     - `examples/prisma-next-demo/src/prisma/context.ts`
     - `examples/prisma-orm-demo/src/prisma-next/runtime.ts`
     - `examples/prisma-orm-demo/test/budgets.integration.test.ts`
   - **Docs**
     - `AGENTS.md`
     - `docs/reference/query-patterns.md`
     - `docs/reference/typescript-patterns.md`
     - `docs/architecture docs/subsystems/4. Runtime & Plugin Framework.md`
     - `docs/reference/test-import-patterns.md`
     - `test/utils/README.md`
   - **Rules**
     - `.cursor/rules/validate-contract-usage.mdc`
   - **Tests / fixtures** (expect import-pattern checks to fail until updated)
     - `test/integration/test/contract-imports.test.ts` (+ any fixtures it validates)
     - `test/integration/test/fixtures/cli/**/contract.ts`
     - `test/integration/test/utils/cli-test-helpers.ts`
     - `test/integration/test/runtime.test.ts`
     - `test/integration/test/sql-dml.test.ts`
     - `test/integration/test/budgets.test.ts`
     - `test/integration/test/kysely.test.ts`
     - `packages/2-sql/3-tooling/family/src/core/control-instance.ts`
     - `packages/3-extensions/pgvector/README.md` (if it shows usage snippet)
5. [x] Remove old export (no shims):
   - Update `packages/2-sql/2-authoring/contract-ts/src/exports/contract.ts` to stop exporting `validateContract`
   - If `./contract` entrypoint becomes redundant, remove/reshape it as appropriate (no compatibility reexports)

### Minimal validation for this milestone

6. [x] Run targeted checks:
   - `pnpm -F @prisma-next/sql-contract test`
   - `pnpm -F @prisma-next/sql-contract-ts test` (ensure removal doesn’t break authoring package)
   - `pnpm lint:deps` (layering/import validation)

---

## Milestone 2 — New package scaffolding: `@prisma-next/postgres`

1. [ ] Create a new workspace package for the one-liner client:
   - **Location**: `packages/3-targets/8-clients/postgres/` (new directory)
   - **Name**: `@prisma-next/postgres`
   - **Entry point**: `@prisma-next/postgres/runtime` (default export `postgres`)
2. [ ] Scaffold minimal package boilerplate aligned with repo conventions:
   - `package.json` with `exports` for `./runtime`
   - `biome.jsonc`, `tsconfig.json`, `tsconfig.build.json`, `tsup.config.ts`, `vitest.config.ts` (mirror nearby Postgres packages in `packages/3-targets/**/postgres`)
   - `src/exports/runtime.ts`
3. [ ] Add `README.md` for the new package (doc-maintenance):
   - Responsibilities + dependency list
   - Mermaid architecture diagram showing composition over target/adapter/driver + sql-runtime + core-execution-plane
   - Link to this spec

---

## Milestone 3 — Implement `postgres(...)` lazy client

### Types + binding normalization (pure, eager-safe)

1. [ ] Add internal types and binding model:
   - `src/runtime/types.ts`: `PostgresClient`, `PostgresOptions*`, `PostgresBinding`, `PostgresTargetId`
   - `src/runtime/binding.ts`: resolve `{ binding | url | pg }` into a single `PostgresBinding`
   - Validation: throw if multiple binding inputs are provided (still no runtime init)

### Static surface construction (runs inside `postgres(...)`)

2. [ ] Implement `src/runtime/postgres.ts`:
   - Validate contract:
     - If `contractJson` provided → `validateContract<TContract>(contractJson)` from `@prisma-next/sql-contract/validate`
     - Else use `contract` directly
   - Build stack descriptors (static only):
     - `createSqlExecutionStack({ target, adapter, driver, extensionPacks })` from `@prisma-next/sql-runtime`
     - Use Postgres descriptors:
       - `@prisma-next/target-postgres/runtime`
       - `@prisma-next/adapter-postgres/runtime`
       - `@prisma-next/driver-postgres/runtime`
   - Create static context:
     - `createExecutionContext({ contract, stackInstance? / stack? })` (use the correct existing primitive)
   - Create query roots:
     - `sql({ context })` from `@prisma-next/sql-lane`
     - `schema(context)` from `@prisma-next/sql-relational-core/schema`
     - `orm({ context })` from `@prisma-next/sql-orm-lane`
   - Return `{ sql, schema, orm, context, stack, runtime }` where `runtime()` is lazy + memoized.

### Lazy runtime boundary (runs only inside `db.runtime()`)

3. [ ] Implement runtime constructor inside `runtime()`:
   - Instantiate stack: `instantiateExecutionStack(stack)` from `@prisma-next/core-execution-plane/stack`
   - Bind driver:
     - If binding is `url`: create `pg.Pool` inside `runtime()` (never earlier)
     - If binding is `pgPool` / `pgClient`: reuse provided object
   - Create runtime: `createRuntime({ stackInstance, context, driver, plugins, verify })` from `@prisma-next/sql-runtime`
   - Memoize runtime instance
4. [ ] Set MVP verify defaults:
   - `verify: { mode: 'onFirstUse', requireMarker: false }` (unless repo has a canonical helper/default)

### Minimal automated validation (keep tiny)

5. [ ] Add a minimal unit test in the new package asserting:
   - `postgres(...)` does not eagerly call `instantiateExecutionStack` / `createRuntime` / create `pg.Pool`
   - `db.runtime()` memoizes (same instance on subsequent calls)

---

## Milestone 4 — Demo migration (primary validation)

1. [ ] Collapse demo configuration to “one file, one call”:
   - **Add**: `examples/prisma-next-demo/src/prisma/db.ts` (or `src/db.ts`) exporting `db`
   - **Use**: `import postgres from '@prisma-next/postgres/runtime'`
   - Contract workflow:
     - emitted: `contract.json` + `contract.d.ts` typed via `postgres<Contract>({ contractJson, url, ... })`
     - or TS-authored: `postgres({ contract, url, ... })`
2. [ ] Update demo call sites to import static roots from `db`:
   - Replace direct `sql/schema/orm/context/runtime` wiring with `db.sql`, `db.schema`, `db.orm`, `db.context`
   - Ensure execution path calls `db.runtime()` only at the execution boundary
3. [ ] Remove old demo wiring modules once unreferenced:
   - `examples/prisma-next-demo/src/prisma/context.ts` (and any paired `runtime.ts`-style module if present)
4. [ ] Smoke validate demo behavior:
   - Demo loads without DB connection side effects at import-time
   - First query execution triggers runtime init via `db.runtime()`

---

## Milestone 5 — Cleanup + docs consistency

1. [ ] Update usage snippets to reflect new imports:
   - `AGENTS.md` query pattern snippet: use `@prisma-next/sql-contract/validate` and `@prisma-next/postgres/runtime` where appropriate
   - Docs/rules that mention `@prisma-next/sql-contract-ts/contract` or manual demo composition
2. [ ] Run repo checks that are likely to catch regressions:
   - `pnpm test:packages` (or narrower filters if available)
   - `pnpm lint:deps`
3. [ ] Ensure package READMEs remain accurate for touched packages (especially the new `@prisma-next/postgres`).

