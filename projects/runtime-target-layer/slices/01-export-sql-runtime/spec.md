# Slice: export-sql-runtime

Parent project: `projects/runtime-target-layer/`. Outcome: the family-layer SQL runtime class is a stable, exported, subclassable symbol — the foundation slices 2–3 build the session-bootstrap primitive and the Supabase subclass on.

## At a glance

Rename the private `SqlRuntimeImpl` to `SqlRuntime` and export it from `@prisma-next/sql-runtime`. `createRuntime` keeps returning it; no behaviour changes. Today the class is package-private — the package's public surface exposes only `createRuntime` / `withTransaction` — so the export is purely additive.

## Chosen design

**Amended (operator correction, 2026-06-09).** Exporting the *concrete* class broke the repo's interface + factory pattern (consumers depend on the interface, never the implementation — the unexported `Impl` was the enforcement). The corrected shape distinguishes the subclass seam from the consumer surface:

- `export abstract class SqlRuntime` — the extension seam. Carries the full implementation (including the protected hooks); `abstract` makes it un-instantiable, so its only use outside the package is `extends`.
- `class DefaultSqlRuntime extends SqlRuntime {}` — package-private concrete leaf, NOT exported. The `Impl` role returns under a name that can't be confused with the old symbol.
- `createRuntime(...): Runtime` constructs `DefaultSqlRuntime` and keeps returning the `Runtime` interface — app consumers never receive the class as a value.

Residual, accepted: an exported abstract class can still be *type-coupled* to (`(rt: SqlRuntime) => …`); that is inherent to having a cross-package subclass seam. Optional follow-on if stronger discouragement is wanted: move the class export to a dedicated subpath (e.g. `/extend`), keeping the main barrel interface-only. Not in this slice.

Original design below (superseded only in the export shape — the rename itself stands). The symbol appears in exactly four places today (verified):

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

- [ ] `rg "SqlRuntimeImpl"` returns zero results in code/tests/docs after the rename (`projects/**` planning records exempt).
- [ ] `SqlRuntime` is importable from `@prisma-next/sql-runtime` (present in `src/exports/index.ts`) and is `abstract` — `new SqlRuntime(...)` is a compile error outside the package.
- [ ] `DefaultSqlRuntime` (the concrete leaf) is NOT exported from the package; `createRuntime` constructs it and still returns `Runtime`.
- [ ] No behaviour change: the existing `@prisma-next/sql-runtime` test suite passes unchanged (no test assertions modified beyond the renamed `describe` label and any test-local instantiation switching to the leaf pattern).

## Open Questions

None.

## References

- Parent project: `projects/runtime-target-layer/spec.md`
- Linear issue: [TML-2878](https://linear.app/prisma-company/issue/TML-2878)
- `no-backward-compatibility` rule (no alias for the old symbol).
