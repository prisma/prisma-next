# Slice: export-sql-runtime

Parent project: `projects/runtime-target-layer/`. Outcome: the family-layer SQL runtime class is a stable, exported, subclassable symbol — the foundation slices 2–3 build the session-bootstrap primitive and the Supabase subclass on.

## At a glance

Rename the private `SqlRuntimeImpl` to `SqlRuntime` and export it from `@prisma-next/sql-runtime`. `createRuntime` keeps returning it; no behaviour changes. Today the class is package-private — the package's public surface exposes only `createRuntime` / `withTransaction` — so the export is purely additive.

## Chosen design

`class SqlRuntimeImpl` → `class SqlRuntime` in `packages/2-sql/5-runtime/src/sql-runtime.ts`, added to the package's export barrel. The symbol appears in exactly four places today (verified):

| Location | Change |
| --- | --- |
| `src/sql-runtime.ts:170` — `class SqlRuntimeImpl<…>` | rename to `SqlRuntime` |
| `src/sql-runtime.ts:868` — `return new SqlRuntimeImpl({…})` in `createRuntime` | rename call site |
| `src/exports/index.ts` — `export { createRuntime, withTransaction }` | add `SqlRuntime` to the exported symbols |
| `test/sql-runtime-abort.test.ts:216` — `describe('SqlRuntimeImpl.execute…')` | rename the describe label |
| `packages/2-mongo-family/7-runtime/src/mongo-runtime.ts:106` — comment referencing `SqlRuntimeImpl#executeAgainstQueryable` | update the comment text |

`createRuntime`'s return type stays `Runtime` (the interface) — unchanged. No `SqlRuntimeImpl` alias (repo no-backward-compatibility rule).

## Coherence rationale

One mechanical rename of a single symbol across its handful of references, plus one additive export line. One reviewer reads it top-to-bottom in a minute. It is deliberately kept as its own PR (not folded into slice 2) so that the runtime hot path is provably unchanged by the rename alone, before any new primitive lands — per the project's transitional-shape constraint.

## Scope

**In:** the `SqlRuntimeImpl`→`SqlRuntime` rename at its four reference sites; the additive export from `@prisma-next/sql-runtime`.

**Out:** the `executeWithSessionBootstrap` primitive (slice 2); `PostgresRuntime` / `SupabaseRuntime` (slice 3); any change to `createRuntime`'s signature or return type; any Mongo-side rename (Mongo's class keeps its own name).

## Pre-investigated edge cases

**None pre-investigated.** The grep above is exhaustive for the symbol; the implementer re-runs it at dispatch time to confirm no new references appeared. New edge cases amend this spec via `drive-discussion` per invariant I12.

## Slice-specific done conditions

- [ ] `rg "SqlRuntimeImpl"` returns zero results across the workspace after the rename.
- [ ] `SqlRuntime` is importable from `@prisma-next/sql-runtime` (present in `src/exports/index.ts`).
- [ ] No behaviour change: the existing `@prisma-next/sql-runtime` test suite passes unchanged (no test assertions modified beyond the renamed `describe` label).

## Open Questions

None.

## References

- Parent project: `projects/runtime-target-layer/spec.md`
- Linear issue: [TML-2878](https://linear.app/prisma-company/issue/TML-2878)
- `no-backward-compatibility` rule (no alias for the old symbol).
