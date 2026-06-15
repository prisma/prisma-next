# Brief: D2 — PG `*Call.toOp` rewires to `lowerToDriverStatement`; framework interface widens; PG + framework consumers add `await Promise.all`

## What this dispatch does

D1 landed the substrate (`DriverStatement` type + `lowerToDriverStatement` on both adapters) at commit `330dccc82`, purely additively. D2 wires up the PG consumers:

1. Two PG `*Call` classes' `toOp()` methods become `async` and delegate to the new `lowerToDriverStatement`.
2. The framework `MigrationPlan.operations` / `MigrationPlanWithAuthoringSurface.operations` types widen to `(Op | Promise<Op>)[]` so the async `toOp` returns can flow through.
3. Every PG-side or framework-side consumer of `plan.operations` adds `await Promise.all(...)` at the consumption boundary.

After this dispatch, PG migrations with `Date` / `bigint` / `jsonb` literal defaults emit correct codec-routed SQL — that's the bug fix manifesting. Existing PG migration goldens will regenerate for those cases; the regen IS the intended bug fix.

SQLite is untouched in D2 (D3's scope). Mongo is untouched (already correct).

## Concrete changes

### 1. Widen the framework `*Call.toOp` abstract return type

Where: `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts:190`.

```ts
// before
export interface OpFactoryCall {
  // ...
  toOp(): MigrationPlanOperation;
}

// after
export interface OpFactoryCall {
  // ...
  toOp(): MigrationPlanOperation | Promise<MigrationPlanOperation>;
}
```

### 2. Widen the framework `MigrationPlan(WithAuthoringSurface).operations` types

Same file, around lines 201 and 252. Both interfaces' `operations` field widens:

```ts
// before
export interface MigrationPlan {
  readonly operations: readonly MigrationPlanOperation[];
  // ...
}

// after
export interface MigrationPlan {
  readonly operations: readonly (MigrationPlanOperation | Promise<MigrationPlanOperation>)[];
  // ...
}
```

`MigrationPlanWithAuthoringSurface extends MigrationPlan` — the child inherits the widened type. Both implementations adapt in step 3.

For target-narrowed interfaces (`SqlMigrationPlan<TTargetDetails>` at `packages/2-sql/9-family/src/core/migrations/types.ts:41` and `:254`), the same widening: `readonly (SqlMigrationPlanOperation<TTargetDetails> | Promise<SqlMigrationPlanOperation<TTargetDetails>>)[]`.

In practice, the serialized form (post-`stripOperations`) only contains sync `Op`s — Promises don't survive JSON. The widening is a type-level statement that consumers must `await Promise.all` defensively; it's a no-op when there are no actual promises. `stripOperations` materializes at the serialization boundary.

### 3. Update `PostgresOpFactoryCall` base + adapt all subclass `toOp` signatures

Where: `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts`.

The abstract `PostgresOpFactoryCall` base class's `toOp` declaration widens to allow `Promise<Op>` return. Every concrete subclass that has a sync `toOp` body stays internally sync (TypeScript narrows the return type per implementation). Only `CreateTableCall` and `CreateSchemaCall` actually become async — see step 4.

### 4. Migrate PG `CreateTableCall.toOp` and `CreateSchemaCall.toOp` to `lowerToDriverStatement`

Where: same file, around lines 209 (CreateTableCall) and 944 (CreateSchemaCall).

```ts
// before — CreateTableCall
toOp(lowerer?: Lowerer): Op {
  if (lowerer === undefined) throw errorMissingLowerer(this.tableName);
  const node = contractFreeDdl.createTable({
    schema: this.schemaName,
    table: this.tableName,
    columns: this.columns,
    ...(this.constraints ? { constraints: this.constraints } : {}),
  });
  const { sql } = lowerer.lower(node, { contract: {} });
  return { id, label, /* ... */, execute: [step(`create table "${this.tableName}"`, sql)] };
}

// after
async toOp(lowerer?: Lowerer): Promise<Op> {
  if (lowerer === undefined) throw errorMissingLowerer(this.tableName);
  const node = contractFreeDdl.createTable({
    schema: this.schemaName,
    table: this.tableName,
    columns: this.columns,
    ...(this.constraints ? { constraints: this.constraints } : {}),
  });
  const statement = await lowerer.lowerToDriverStatement(node, { contract: {} });
  return { id, label, /* ... */, execute: [{ description: `create table "${this.tableName}"`, sql: statement.sql, params: statement.params }] };
}
```

`step()` helper today builds `{ description, sql }`. Either widen `step()` to accept `params` (preferred) or inline the object literal as shown. Whichever keeps the diff smallest.

Same shape for `CreateSchemaCall.toOp`. `CREATE SCHEMA` has no literal defaults, so `statement.params` will always be empty — but the codec-routed path is uniform, so still use `lowerToDriverStatement`.

### 5. Adapt `PlannerProducedPostgresMigration.operations` getter

Where: `packages/3-targets/3-targets/postgres/src/core/migrations/planner-produced-postgres-migration.ts:62`.

The getter body doesn't change — `renderOps(this.#calls, this.#lowerer)` already returns an array. The return type widens:

```ts
// before
override get operations(): readonly Op[] {
  return renderOps(this.#calls, this.#lowerer);
}

// after
override get operations(): readonly (Op | Promise<Op>)[] {
  return renderOps(this.#calls, this.#lowerer);
}
```

`renderOps` itself (find it; likely `packages/3-targets/3-targets/postgres/src/core/migrations/render-ops.ts`) returns `calls.map(c => c.toOp(lowerer))` — that already returns `(Op | Promise<Op>)[]` because of the widened abstract. No body changes.

### 6. PG-side consumer `await Promise.all`

Two files surfaced by the brief plan:

**`packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts`** — sites at ~97, 165, 220, 637 today access `options.plan.operations.length` / iterate `for (const op of options.plan.operations)`. The runner's entry point (whichever method consumes the plan first — likely `execute()` or its caller) materializes once:

```ts
async execute(options) {
  const ops = await Promise.all(options.plan.operations);
  // ... use `ops` everywhere `options.plan.operations` was used
}
```

Pass the materialized `ops` array forward to helpers that previously took `options.plan` directly, or replace each `options.plan.operations` reference with `ops` once it's in scope. Whichever fits the runner's existing internal call graph cleanest.

**`packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts`** — sites at ~692, 697 today access `planResult.operations`. The agent earlier surfaced that this is actually `planResult.operations` from a codec hook result (a different shape), not `MigrationPlanWithAuthoringSurface.operations` — verify with `grep -n 'planResult.operations\|planResult\.plan'` in this file. If it's a different shape, leave alone. If it's the live plan's operations, add `await Promise.all`.

### 7. Framework-side consumer: `synth.ts`

Where: `packages/1-framework/3-tooling/migration/src/aggregate/strategies/synth.ts:121, 131`.

```ts
// before
displayOps: synthedPlan.operations,
operationCount: synthedPlan.operations.length,

// after — once near the start of the relevant function:
const synthedOps = await Promise.all(synthedPlan.operations);
// then in the result construction:
displayOps: synthedOps,
operationCount: synthedOps.length,
```

The containing function is already async (it's part of an async strategy walk).

### 8. `stripOperations` materialization

Find `stripOperations` — likely in `packages/1-framework/3-tooling/migration/` or `packages/1-framework/3-tooling/cli/`. It's the function that takes a live `MigrationPlanWithAuthoringSurface` and produces the serialized `MigrationPlan` shape for persistence to ops.json. It needs to `await Promise.all(plan.operations)` and store the result in the serialized output's `operations` field.

```ts
// sketch
async function stripOperations(plan) {
  const operations = await Promise.all(plan.operations);
  return {
    ...plan,
    operations,  // ← now a plain Op[], no promises, JSON-safe
  };
}
```

If `stripOperations` was sync, it becomes async. Adapt its callers.

### 9. CLI consumers

CLI files in `packages/1-framework/3-tooling/cli/src/` access `result.plan.operations` and `space.operations` from the SERIALIZED form (post-`stripOperations`). Those are JSON-deserialized objects, not live plans — they don't contain promises. **Leave them alone** unless grep shows a site that's actually accessing a live `MigrationPlanWithAuthoringSurface` instance's `.operations`.

Verify with `git grep -n '\.operations' packages/1-framework/3-tooling/cli/src/` and confirm each match is against a serialized shape.

### 10. SQLite stays untouched

D3's scope. Do NOT touch:
- `SqliteOpFactoryCall` or any of its subclasses.
- `SqliteControlAdapter` (the existing `lower` body, the renderer, etc. — only D1's `lowerToDriverStatement` is there, already done).
- `packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts` — D3 adapts this.
- SQLite tests.

If grep shows you about to modify a SQLite file, halt.

## Completed when

- [ ] `OpFactoryCall.toOp()` declared return type allows `MigrationPlanOperation | Promise<MigrationPlanOperation>`.
- [ ] `MigrationPlan.operations` and `MigrationPlanWithAuthoringSurface.operations` both widened to `readonly (Op | Promise<Op>)[]`. Target-narrowed interfaces (`SqlMigrationPlan`) widened in step.
- [ ] PG `CreateTableCall.toOp` is `async` and delegates to `lowerer.lowerToDriverStatement`. Same for `CreateSchemaCall.toOp`.
- [ ] All other PG `*Call.toOp` subclasses keep their sync bodies, signature still compatible with the widened abstract.
- [ ] `PlannerProducedPostgresMigration.operations` getter return type widened; body unchanged.
- [ ] PG `runner.ts` consumers add `await Promise.all` at the right boundary; iterations downstream see materialized `Op[]`.
- [ ] `synth.ts` consumers (`~121, 131`) add `await Promise.all` once near the start of the containing function; downstream uses materialized array.
- [ ] `stripOperations` (or equivalent serialization step) awaits all promises before producing the serialized form.
- [ ] CLI consumers consuming serialized-form `.operations` left untouched (verified by grep that they don't access live `MigrationPlanWithAuthoringSurface` instances).
- [ ] **SQLite untouched.** `git diff main..HEAD -- packages/3-targets/3-targets/sqlite/` shows D1's additions only; no D2 changes.
- [ ] PG migration goldens regenerate for `Date` / `bigint` / `jsonb` literal default cases — the regen IS the bug fix manifesting. Capture which fixtures regenerated and why in the dispatch summary.
- [ ] PG runtime query path tests untouched and green.
- [ ] `pnpm typecheck` green workspace-wide.
- [ ] `pnpm --filter @prisma-next/target-postgres test` green.
- [ ] `pnpm --filter @prisma-next/adapter-postgres test` green (D1's new tests still pass).
- [ ] `pnpm test:packages` green (cross-package).
- [ ] `pnpm fixtures:check` green (after the expected PG fixture regens are accepted).
- [ ] `pnpm lint:deps` + `pnpm lint:casts` green.
- [ ] The user-authoring shape in `examples/*/migrations/**/migration.ts` is byte-for-byte unchanged — no async, no await, no method-name changes.

## Halt conditions

- A SQLite file gets modified. Halt — D3's scope.
- Modifying `lower()` or the renderer or `LoweredStatement` / `LoweredParam`. Halt — those stay byte-for-byte unchanged in D2 too (D1's constraint persists).
- A PG migration golden regenerates with output WORSE than the broken type-branching produced (e.g. the codec produces something that fails to round-trip through PG). Halt with the diff.
- A consumer of the live plan's `.operations` lives outside async context and can't easily `await`. Halt — surface the call site.
- The runtime query path tests fail. Halt — the dispatch leaked.
- More than 30 files modified. Halt — the change should be ~15-25 files (framework type widening + PG `*Call` + PG runner + planner-strategies + synth + stripOperations + maybe a few helpers).
- 200+ tool calls without committing. Halt.

## Standing instruction

Stay focused on PG + framework. Do not touch SQLite. Do not touch the runtime query path. The `await Promise.all` adaptations are mechanical — find each consumer site, materialize the array once near the entry point, replace downstream references.

## References

- **Spec:** [`../spec.md`](../spec.md).
- **Plan:** [`../plan.md`](../plan.md) § Dispatch 2.
- **D1 brief (substrate):** [`./01-async-interface-plumbing.md`](./01-async-interface-plumbing.md).
- **D1 commit:** `330dccc82` — adds `DriverStatement` + `lowerToDriverStatement` on both adapters.
- **PG `*Call.toOp` site:** `packages/3-targets/3-targets/postgres/src/core/migrations/op-factory-call.ts:209` (CreateTableCall), `:944` (CreateSchemaCall).
- **PG planner-produced migration:** `packages/3-targets/3-targets/postgres/src/core/migrations/planner-produced-postgres-migration.ts:62`.
- **PG runner:** `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts` (consumer sites ~97, 165, 220, 637).
- **PG planner-strategies:** `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts` (~692, 697 — verify these are live-plan consumers).
- **Framework `MigrationPlan` types:** `packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts:164, 201, 252`.
- **`synth.ts`:** `packages/1-framework/3-tooling/migration/src/aggregate/strategies/synth.ts:121, 131`.

## Operational metadata

- **Model tier:** sonnet — mechanical refactor.
- **Time-box:** 90 minutes wall-clock.
- **Tool-call budget:** 200 max before committing intermediate state.

## Repo standing constraints

- Worktree: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`.
- Branch: `tml-2867-codec-routed-ddl-defaults`. HEAD: `330dccc82`.
- `pnpm`, never `npm` / `npx`.
- No bare `as` casts in production code; tests exempt.
- No TS import file extensions.
- No transient project refs in code or comments.

## Commit + sign-off

Commit on `tml-2867-codec-routed-ddl-defaults`. Sign off as `Will Madden <madden@prisma.io>`. End with `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`. Commit message describes the structural change (e.g. `wire PG *Call.toOp through lowerToDriverStatement; widen MigrationPlan.operations to allow Promise<Op>; consumers await Promise.all`).
