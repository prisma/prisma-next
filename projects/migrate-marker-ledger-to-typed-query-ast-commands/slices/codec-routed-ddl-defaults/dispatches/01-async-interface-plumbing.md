# Brief: D1 — Async the DDL render + lower chain (no behaviour change)

## Mental model — read this before you touch any file

This dispatch flips a chain of interfaces from sync to async. **Every interface listed below is REPLACED, not augmented.** There is no compatibility shim, no sibling method, no "preserve the sync surface for existing callers." The whole chain becomes async end-to-end as one structural transition, and every consumer adapts via `await`.

The reason is structural: each link in the chain awaits the one below it. If any link stays sync, the link above can't await — and the codec routing that D2 and D3 will add requires `await codec.encode(...)` at the bottom of the chain. The whole chain has to flip together.

### Anti-pattern — DO NOT do this

```ts
// WRONG — adding a sibling method next to the sync surface
interface MigrationPlanWithAuthoringSurface {
  readonly operations: readonly Op[];              // ← left in place
  getOperations(): Promise<readonly Op[]>;          // ← added next to it
}
```

If you find yourself writing this shape — both the old and the new on the same interface — **halt and surface**. The sync surface has to go.

### Right shape

```ts
// RIGHT — the sync surface is removed; consumers add `await`
interface MigrationPlanWithAuthoringSurface {
  getOperations(): Promise<readonly Op[]>;          // ← replaces the old getter
}
```

Same applies to `Lowerer.lower()` and `*Call.toOp()` and `renderOps()`. The sync signature is gone; the async signature replaces it; every consumer adds `await`.

If a consumer is in a non-async function and can't easily add `await`, **halt and surface** (the spec asserts all consumers are already async — if you find one that isn't, that's a real discovery, not something to work around with a side method).

## Scope — five surfaces only

1. **`DdlColumnDefaultVisitor<R>` interface** at `packages/2-sql/4-lanes/relational-core/src/ast/ddl-types.ts`. The interface stays as-is structurally (it's already parameterized on `R`). The two concrete `defaultVisitor` implementations on each target's `ddl-renderer.ts` change from `DdlColumnDefaultVisitor<string>` to `DdlColumnDefaultVisitor<Promise<string>>`. Their method bodies wrap their existing return values in `Promise.resolve(...)` — no logic change. The `DdlColumnDefault.accept<R>(visitor, ctx): R` signature is unchanged; at the renderer's call sites, `R` is now `Promise<string>`, so the `accept()` result gets `await`-ed.

2. **`Lowerer.lower()` interface** at `packages/2-sql/9-family/src/core/control-adapter.ts:31`. **REPLACE** the return type — `LoweredStatement` becomes `Promise<LoweredStatement>`. The two implementations (`PostgresControlAdapter.lower` and `SqliteControlAdapter.lower`) become `async` and `await` the renderer's now-async output (because `renderLoweredDdl` becomes async — see below). Every consumer of `lowerer.lower(...)` adds `await`.

3. **Abstract `*Call.toOp()`** on both targets' base classes. **REPLACE** the abstract signature — `toOp(lowerer?: Lowerer): Op` becomes `toOp(lowerer?: Lowerer): Promise<Op>`. Every concrete subclass becomes `async toOp(...): Promise<Op>`. The three calls that use `lowerer.lower(...)` (PG `CreateTableCall.toOp`, PG `CreateSchemaCall.toOp`, SQLite `CreateTableCall.toOp`) `await` it; every other concrete `toOp` body stays internally sync but returns from an `async` function (so the `Op` value is auto-wrapped in `Promise<Op>`).

4. **`renderColumn`, the visitor `createTable` / `createSchema` entries, `renderLoweredDdl`** on both targets' `ddl-renderer.ts`. All become `async`. The `createTable` visitor body uses `await Promise.all(columns.map(renderColumn))` (`renderColumn` is per-column-async). The renderer's `defaultVisitor.literal` keeps its existing type-branching body unchanged — it just returns through `Promise.resolve(...)` now.

5. **`MigrationPlanWithAuthoringSurface.operations`** at `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts:227`. **REPLACE** the sync getter — `readonly operations: readonly Op[]` becomes `getOperations(): Promise<readonly Op[]>`. Both implementations (`PlannerProducedPostgresMigration` at `planner-produced-postgres-migration.ts:62`, `PlannerProducedSqliteMigration` at `planner-produced-sqlite-migration.ts`) implement the new method. The body calls the now-async `renderOps(this.calls, this.lowerer)` and returns the `Promise<Op[]>`. `renderOps` itself becomes `async` and `await`s each `*Call.toOp(lowerer)`.

Consumer call sites (all already in async context — `await` is the only change):
- `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts` (4 sites: ~97, 165, 220, 637)
- `packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts` (5 sites: ~60, 125, 246, 615, 617)
- `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts` (2 sites: ~692, 697)

**Not in scope (verified by grep):** CLI consumers in `packages/1-framework/3-tooling/cli/src/` access `result.plan.operations` and `space.operations` on the **serialized** form (post-`stripOperations`), not the live `MigrationPlanWithAuthoringSurface` instance. Those stay sync. **Verify** with `git grep -n "\.operations" packages/1-framework/3-tooling/cli/src/` and confirm every match is against a serialized `result.plan` / `space` / `entry.plan` shape, not a live planner-produced instance. If you find one that's a live instance, it's in scope.

## Explicitly OUT of scope

- **`LiteralColumnDefault.codec` field.** Deferred to D2/D3 — each target adopts the codec field as part of its renderer routing work. D1 does not touch `LiteralColumnDefault`'s constructor, fields, or any of its construction sites.
- **`codecLookup` threading through `IssuePlannerOptions` / `StrategyContext`.** Deferred to D2/D3 for the same reason.
- **Any `await codec.encode(...)` call.** D2/D3 own that.
- **Any deletion of `defaultVisitor.literal`'s existing type-branching.** D2/D3 own that.
- **The `wireToDefaultLiteral` helper.** D2/D3 own that.
- **Mongo.** The DDL chain is SQL-only.
- **`planner-ddl-builders.ts`'s `renderDefaultLiteral`** (Phase 2 + schema-verify hook callers).
- **Fixture / golden regeneration.** No behaviour change.

## Completed when

- [ ] `Lowerer.lower()` returns `Promise<LoweredStatement>` at the interface declaration; the old sync signature is gone.
- [ ] Abstract `*Call.toOp()` returns `Promise<Op>` on both PG and SQLite base classes; the old sync signature is gone.
- [ ] Both targets' `defaultVisitor` is typed as `DdlColumnDefaultVisitor<Promise<string>>`; method bodies wrap returns with `Promise.resolve(...)` (no logic change).
- [ ] Both targets' `renderColumn`, `createTable` / `createSchema` visitor entries, `renderLoweredDdl`, `*ControlAdapter.lower`, every `*Call.toOp()` method, and `renderOps()` are `async`.
- [ ] `MigrationPlanWithAuthoringSurface` declares `getOperations(): Promise<readonly Op[]>` and **does not declare a `readonly operations: readonly Op[]` member**. Both `PlannerProducedPostgresMigration` and `PlannerProducedSqliteMigration` implement only the new method.
- [ ] Consumers in both targets' `runner.ts` + `planner-strategies.ts` adapt (`.operations` → `await migration.getOperations()`).
- [ ] `pnpm typecheck` green at workspace root.
- [ ] `pnpm test:packages` green.
- [ ] `pnpm fixtures:check` green.
- [ ] `pnpm lint:deps` green.
- [ ] `pnpm lint:casts` delta zero.
- [ ] No goldens regenerated. No fixture diffs.

## Halt conditions — STOP and surface, do not work around

- You find yourself adding a sibling method (e.g. `getOperations()`) next to the sync surface you're supposed to replace. **Halt.** The sync surface has to go.
- A consumer of `MigrationPlanWithAuthoringSurface.operations` lives in a sync function and can't easily add `await`. **Halt.** This is a real discovery the spec didn't anticipate.
- A consumer of `Lowerer.lower()` or `*Call.toOp()` lives in a sync function. **Halt.**
- The `MigrationPlan` interface (the framework-side parent of `MigrationPlanWithAuthoringSurface`) has the `operations` field too and changing it ripples to consumers you haven't enumerated. **Halt** with the list of unexpected consumers.
- A test fixture's expected output changes (a golden has to be regenerated). **Halt.** D1 is no-behaviour-change.
- More than 30 source files modified. **Halt.** The change should be ~15-25 files (5 interface surfaces + implementations + consumer adapters).
- You've made 200+ tool calls without committing. **Halt.** You're lost; surface the current state.

## Standing instruction

Stay focused. Mechanical signature plumbing only. Do NOT improve adjacent code. Do NOT delete the existing `defaultVisitor.literal` type-branching. Do NOT touch `LiteralColumnDefault`'s constructor.

**Make the structural changes first; adapt consumers second; touch tests last.** If `pnpm typecheck` is red at the workspace root after the production-side changes, surface the failing call sites — don't paper over with `as Promise<Op>` casts.

## References

- **Spec:** [`../spec.md`](../spec.md) — full design.
- **Plan:** [`../plan.md`](../plan.md) § Dispatch 1.
- **Codec interface (not used in D1, just for context):** `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts:75`.
- **PG structural oracle:** `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:209` (PG `CreateTableCall.toOp`).
- **SQLite structural mirror:** `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts:141` (SQLite `CreateTableCall.toOp`).
- **`MigrationPlanWithAuthoringSurface`:** `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts` (grep for the exact line).

## Operational metadata

- **Model tier:** sonnet.
- **Time-box:** 90 minutes wall-clock. If you're not done in 90 min, surface the current state — do not push past the budget.
- **Tool-call budget:** 200 max before committing intermediate state. If you hit 200 without a green typecheck, commit what you have on `tml-2867-codec-routed-ddl-defaults` with a status message and surface.

## Repo standing constraints

- Worktree: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`.
- Branch: `tml-2867-codec-routed-ddl-defaults` (HEAD = `6b6c8cddb`).
- `pnpm`, never `npm` / `npx`.
- No bare `as` casts in production code; tests exempt. If unavoidable for a Promise narrowing, use `blindCast<T, 'reason'>` with a named reason.
- No TS import file extensions.
- **No transient project references in code / comments / test names.** Don't write `// D1` / `// async migration` / `"async-everywhere refactor"`. Describe behaviour. `TML-2867` references are NOT allowed in code in this dispatch — there's no centralized TODO this round.

## Commit + sign-off

Commit on `tml-2867-codec-routed-ddl-defaults`. Sign off as `Will Madden <madden@prisma.io>`. End with `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`. Use a clear commit message describing the structural change ("async the DDL render + lower chain — interface flip, no behaviour change").
