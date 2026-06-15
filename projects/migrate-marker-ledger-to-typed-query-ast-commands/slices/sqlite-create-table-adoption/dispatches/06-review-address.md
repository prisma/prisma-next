# Dispatch 06 — Address PR #768 review

## Four threads

**1. Delete re-export test** (`PRRT_kwDOQM0QJc6H2hlp`) — `packages/3-extensions/sqlite/test/migration/re-export.test.ts` deleted. The test only verified that a facade barrel re-exports symbols, testing the module system rather than behavior. Disposition: **addressed**.

**2. ifDefined on FK constraint** (`PRRT_kwDOQM0QJc6IkSUy`) — Replaced three conditional spread patterns in `ForeignKeyConstraint` construction with `ifDefined('name', fk.name)` / `ifDefined('onDelete', fk.onDelete)` / `ifDefined('onUpdate', fk.onUpdate)`. Imported `ifDefined` from `@prisma-next/utils/defined`. Behavior identical. Disposition: **addressed**.

**3. Exhaustiveness on default switch** (`PRRT_kwDOQM0QJc6H2jwH`) — Added `default` case after the `literal` and `function` cases in `sqliteDefaultToDdlColumnDefault`. The `autoincrement()` skip was preserved with its comment. The `default` branch uses `const exhaustive: never = columnDefault; throw new Error(...)` with `blindCast` to surface the kind in the error message, matching the Postgres sibling pattern. Disposition: **addressed**.

**4. Raw SQL precheck** (`PRRT_kwDOQM0QJc6IkS6_`) — `op-factory-call.ts:164` raw SQL precheck deferred. Converting these verification SELECTs requires the contract-free builder to grow aggregate (`count`) + comparison projection (the AST has `AggregateExpr.count` but `CfSelectQuery.select` is column-only today). Carved out as a follow-up slice `typed-migration-verification-queries`. Disposition: **deferred, not code-touched**.
