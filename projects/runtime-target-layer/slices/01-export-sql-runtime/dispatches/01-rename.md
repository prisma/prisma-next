# Dispatch 1 — rename SqlRuntimeImpl → SqlRuntime + export

## Task
Rename the private class `SqlRuntimeImpl` to `SqlRuntime` and export it from `@prisma-next/sql-runtime`. No behaviour change; the class shape is untouched.

## Reference sites (verified exhaustive — re-grep to confirm)
- `packages/2-sql/5-runtime/src/sql-runtime.ts` — `class SqlRuntimeImpl<…>` declaration + the `new SqlRuntimeImpl({…})` call inside `createRuntime`.
- `packages/2-sql/5-runtime/src/exports/index.ts` — add `SqlRuntime` to the exported symbols (currently exports `createRuntime`, `withTransaction`, and types).
- `packages/2-sql/5-runtime/test/sql-runtime-abort.test.ts` — the `describe('SqlRuntimeImpl.execute…')` label.
- `packages/2-mongo-family/7-runtime/src/mongo-runtime.ts` — a comment referencing `SqlRuntimeImpl#executeAgainstQueryable`.

## Constraints
- NO `SqlRuntimeImpl` back-compat alias (repo no-backward-compatibility rule).
- Do NOT change `createRuntime`'s signature or return type — it stays `Runtime`.
- No new methods, no logic changes.

## Completed when
- [ ] `rg "SqlRuntimeImpl"` returns zero results across the workspace.
- [ ] `SqlRuntime` is exported from `@prisma-next/sql-runtime` (present in `src/exports/index.ts`) and importable.
- [ ] `pnpm --filter @prisma-next/sql-runtime typecheck` green (include the test project).
- [ ] `pnpm --filter @prisma-next/sql-runtime test` green; no test assertion changes beyond the renamed describe label.
- [ ] `pnpm --filter @prisma-next/sql-runtime lint` clean.
- [ ] `pnpm lint:deps` passes.

## Commit
One commit on branch `tml-2878-export-sql-runtime`, authored by Will with DCO sign-off. Message prefix `TML-2878:`.
