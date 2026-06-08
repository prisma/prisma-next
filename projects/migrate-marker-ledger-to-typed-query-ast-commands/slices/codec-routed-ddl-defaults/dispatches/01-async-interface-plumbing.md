# Brief: D1 — Async interface plumbing + codec resolver threading (no behaviour change)

## Task

Make the DDL render / lower chain async-tolerant on both PG and SQLite without changing any behaviour. This dispatch is mechanical signature plumbing — no `codec.encode` call sites in renderer code, no deletion of existing logic, no fixture changes. The point is to leave the repo in a state where D2 (PG renderer codec routing) and D3 (SQLite renderer codec routing) can plug in without further interface work.

Five surfaces change:

1. **`DdlColumnDefaultVisitor<R>` interface** at `packages/2-sql/4-lanes/relational-core/src/ast/ddl-types.ts` — both methods (`literal`, `function`) declare their return type as `R`. The interface stays as-is structurally; concrete uses substitute `R = Promise<string>` going forward. `DdlColumnDefault.accept<R>(visitor, ctx): R` signature unchanged.

2. **`Lowerer.lower()` interface** at `packages/2-sql/9-family/src/core/control-adapter.ts:31` — change return type from `LoweredStatement` to `Promise<LoweredStatement>`.

3. **Abstract `*Call.toOp()` on both targets' base classes** — change return type from `Op` to `Promise<Op>`. Sites:
   - `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts` (the abstract base — find it, likely `PostgresOpFactoryCall`).
   - `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts` (the abstract base — likely `SqliteOpFactoryCall`).

   Every concrete subclass — `CreateTableCall`, `AddColumnCall`, `DropColumnCall`, `CreateIndexCall`, `DropIndexCall`, `DropTableCall`, `RecreateTableCall`, `RawSqlCall`, `CreateSchemaCall` (PG only) — adapts. Concrete bodies stay synchronous internally; return `Promise.resolve(op)` (or mark `async` and return `op`). The three calls that consume `lowerer.lower(...)` — PG `CreateTableCall.toOp`, PG `CreateSchemaCall.toOp`, SQLite `CreateTableCall.toOp` — stay sync in this dispatch (still call the now-async `lower()` but synchronously return a Promise that wraps the sync work; this is technically wrong but only used by D2/D3 which immediately rewrite them. **Easier path:** make them `async` and `await lowerer.lower(...)` — that's the end-state shape anyway, and the dispatch produces a clean intermediate state). Pick the easier path.

4. **`LiteralColumnDefault` gains a required `codec` constructor parameter and readonly field** at `packages/2-sql/4-lanes/relational-core/src/ast/ddl-types.ts`. Constructor signature: `constructor(readonly value: ColumnDefaultLiteralInputValue, readonly codec: Codec<unknown, unknown>)`. `Codec` is exported from `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts`. Every existing construction site (`postgresDefaultToDdlColumnDefault` in PG `op-factory-call.ts:96`; `sqliteDefaultToDdlColumnDefault` in SQLite `issue-planner.ts:272`; any test fixtures that build `LiteralColumnDefault` directly) must pass a codec. **For this dispatch, the construction sites pass a placeholder codec object** — see (5) for how. Test fixtures that build `LiteralColumnDefault` directly can build a trivial codec stub inline.

5. **Codec resolver threading.** The control adapter knows `codecLookup` (a registry that resolves `CodecRef → Codec`). Thread it from the adapter into the planner construction site so the construction-time helpers can resolve the right codec per column. Sites to add a `codecLookup` field:
   - `IssuePlannerOptions` interface (PG: `issue-planner.ts`; SQLite: `issue-planner.ts`).
   - `StrategyContext` interface (PG: `planner-strategies.ts`; SQLite: `planner-strategies.ts`).
   - `create*MigrationPlanner` constructor (PG: `planner.ts`; SQLite: `planner.ts`) — reads `adapter.codecLookup` (or whatever the existing access shape is — grep for `codecLookup` in the adapter files) and threads into `IssuePlannerOptions`.

   The construction-time helpers `postgresDefaultToDdlColumnDefault` and `sqliteDefaultToDdlColumnDefault` gain a `codec: Codec` parameter, supplied by their caller (`toDdlColumn` / `tableToDdlParts` respectively). The caller resolves the codec via the threaded `codecLookup` + the column's storage type / codecRef. **If the call site doesn't have ready access to a `CodecRef` for the column** — surface; the spec assumes the resolution mechanism is straightforward but the exact lookup shape may need a small helper. In that case, for this dispatch, the helper signature can accept `codec?: Codec` with a fallback to a no-op codec stub (encode = identity), and add a `// TODO TML-2867 D2/D3: tighten to required` next to the fallback — explicitly named in the dispatch summary so D2/D3 know to remove it. Do NOT proliferate fallbacks; one centralized fallback only.

6. **`MigrationPlanWithAuthoringSurface` interface change** at `framework-components/control` (likely in `packages/1-framework/.../components/control/` — grep `MigrationPlanWithAuthoringSurface`). Change `get operations(): Op[]` to `getOperations(): Promise<Op[]>`. Both `PlannerProducedPostgresMigration` (`planner-produced-postgres-migration.ts:62`) and `PlannerProducedSqliteMigration` (`planner-produced-sqlite-migration.ts`) implementations adapt — replace the getter with an async method that calls `renderOps(calls)`. `renderOps` becomes async — `return Promise.all(calls.map(c => c.toOp(this.lowerer)))` (or whatever the existing renderOps body shape is, just made async).

   All consumers that today call `.operations` change to `await .getOperations()`. Exhaustive consumer list (all already in async context — `await` is the only change):
   - `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts` (4 call sites: lines ~97, 165, 220, 637).
   - `packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts` (5 call sites: lines ~60, 125, 246, 615, 617).
   - `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts` (2 call sites: lines ~692, 697).
   - `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts` (the constructor that returns the live instance — likely needs no change to `.operations` access, but check).

   CLI consumers in `packages/1-framework/3-tooling/cli/src/` (`utils/formatters/migrations.ts`, `commands/db-init.ts`, `commands/db-update.ts`, `commands/migration-show.ts`, `commands/migration-plan.ts`, `control-api/operations/db-run.ts`, `control-api/operations/migrate.ts`) consume `result.plan.operations` / `space.operations` from the **serialized** form (post-`stripOperations`) — they're untouched. **Verify this by grep**: any `result.plan.operations` reference is consuming the serialized JSON shape; any `plan.getOperations()` would be consuming the live instance. The serialized shape stays sync.

## Scope

**In:**
- The five interface changes above.
- Mechanical adaptation of every implementor / caller to the new signatures (`async`, `await`, `Promise.resolve`).
- One centralized fallback codec stub if the per-column codec lookup turns out non-trivial (with an inline TODO referencing TML-2867 D2/D3 to remove).
- `MigrationPlanWithAuthoringSurface` consumer list adapted (`.operations` → `await .getOperations()`).

**Out:**
- Any `await codec.encode(value, ctx)` call in renderer code (D2/D3 own that).
- Any deletion of the existing `defaultVisitor.literal` type-branching (D2/D3 own that).
- Any fixture / golden regeneration (this dispatch is no-behaviour-change).
- Any `wireToDefaultLiteral` helper (D2/D3 own that).
- Mongo. The DDL chain is SQL-only.
- Touching `planner-ddl-builders.ts`'s `renderDefaultLiteral` (stays in place; out of scope per spec).

## Completed when

- [ ] `Lowerer.lower()` interface returns `Promise<LoweredStatement>`.
- [ ] `DdlColumnDefaultVisitor<R>` consumers substitute `R = Promise<string>` cleanly.
- [ ] All `*Call.toOp()` methods (both targets, every subclass) return `Promise<Op>`.
- [ ] `LiteralColumnDefault` has a required `codec` field; every construction site passes one.
- [ ] `codecLookup` resolver field exists on `IssuePlannerOptions` and `StrategyContext` for both targets, threaded from the control adapter at `create*MigrationPlanner` time.
- [ ] `MigrationPlanWithAuthoringSurface.getOperations(): Promise<Op[]>` replaces the sync `operations` getter; both target's planner-produced migrations implement it; consumers in the runner / planner-strategies / planner.ts adapt with `await`.
- [ ] `pnpm typecheck` green at the workspace root.
- [ ] `pnpm test:packages` green.
- [ ] `pnpm fixtures:check` green.
- [ ] `pnpm lint:deps` green.
- [ ] `pnpm lint:casts` delta zero (no new bare casts; if a `blindCast` is unavoidable for a Promise<unknown> → Promise<Op> intermediate, named with a reason string).
- [ ] No goldens regenerated. No fixture diffs.

## Standing instruction

Stay focused; control scope. Mechanical signature plumbing only. Drift halts. Do NOT improve the renderer's existing type-branching while you're in the file — D2/D3 own the renderer rewrite. Do NOT delete the JSON.stringify fallback or any of the existing type branches — those stay in place until D2/D3 land.

## Halt conditions

- A consumer of `MigrationPlanWithAuthoringSurface.operations` lives outside async context (CLI sync formatter that consumes the live instance — unlikely per the spec's enumeration, but surface if you find one).
- The per-column codec resolution from `codecLookup` requires more than a one-line helper at the call sites (e.g. it needs a structural new field on `StorageColumn` or a registry call that isn't already in scope) — surface; pick the centralized-fallback path described in (5) and proceed.
- More than 15 source files modified — the change should be ~10-12 (5 interface surfaces × 2 targets + the helper + 3-5 consumer adapters).
- A test fixture that constructs `LiteralColumnDefault` directly is in a non-trivial location that requires a big rewrite to fit the new constructor signature — surface; in that case the test fixture gets a trivial inline codec stub.

## References

- **Spec:** [`../spec.md`](../spec.md) — full design.
- **Plan:** [`../plan.md`](../plan.md) § Dispatch 1.
- **Codec interface:** `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts:75` (`encode(value, ctx) → Promise<TWire>`).
- **PG structural oracle:** `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:209` (PG `CreateTableCall.toOp`); `packages/3-targets/3-targets/postgres/src/core/migrations/issue-planner.ts:203` (`toDdlColumn`); `packages/3-targets/3-targets/postgres/src/core/migrations/planner.ts:131` (planner constructor).
- **SQLite structural mirror:** `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts:141` (SQLite `CreateTableCall.toOp` — the TML-2859 D3 shape); `issue-planner.ts:272` (`sqliteDefaultToDdlColumnDefault`); `planner.ts` (SQLite planner constructor).
- **`MigrationPlanWithAuthoringSurface`:** `packages/1-framework/.../components/control/` — grep `MigrationPlanWithAuthoringSurface` for the exact file path.

## Operational metadata

- **Model tier:** sonnet — pure mechanical signature plumbing.
- **Time-box:** 90 minutes.

## Repo standing constraints

- Worktree: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`.
- `pnpm`, never `npm` / `npx`.
- No bare `as` casts in production code; tests exempt. If unavoidable for a `Promise<unknown> → Promise<Op>` cast, use `blindCast<Op, 'reason'>` with a named reason.
- No TS import file extensions.
- **No transient project references in code / comments / test names.** Describe behaviour, not orchestration. Don't write `// D1` / `it('… (TML-NNNN)')` / `"matches the pre-#NNN behaviour"`. Inline TODOs referencing TML-2867 are allowed for the centralized codec-fallback site only (TML-NNNN is allowed; D1/D2/D3 are not).
