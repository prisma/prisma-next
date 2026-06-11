# Brief: D3 — SQLite `*Call.toOp` rewires to `lowerToDriverStatement`; renderer cleanup

## What this dispatch does

D1 (commit `330dccc82`) landed the substrate (`DriverStatement` + `lowerToDriverStatement` on both adapters). D2 (commit `5728969ea`) wired PG consumers + framework type widening + family-shared consumer adaptations (including SQLite runner's `await Promise.all`). D3 is the SQLite-side `*Call` rewire — the SQLite mirror of D2's PG work, much smaller because the framework widening and consumer-await pattern are already in place.

After this dispatch, SQLite migrations with `Date` / `bigint` literal defaults emit correct codec-routed SQL. SQLite fixture goldens may regenerate for those default cases — that IS the bug fix manifesting.

## Concrete changes

### 1. `SqliteCreateTableCall.toOp` becomes async + delegates to `lowerToDriverStatement`

Where: `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts` (the file with `SqliteCreateTableCall`; the call site of `lowerer.lower(node, ctx)` is around line 141 per the spec).

Current shape (sync, calls existing `lower()`):
```ts
toOp(lowerer?: Lowerer): Op {
  if (lowerer === undefined) throw errorMissingLowerer(this.tableName);
  const node = contractFreeDdl.createTable({...});
  const { sql } = lowerer.lower(node, { contract: {} });
  return { ..., execute: [step(`create table "${this.tableName}"`, sql)] };
}
```

After D3 (async, delegates to new method):
```ts
async toOp(lowerer?: DdlDriverLowerer): Promise<Op> {
  if (lowerer === undefined) throw errorMissingLowerer(this.tableName);
  const node = contractFreeDdl.createTable({...});
  const statement = await lowerer.lowerToDriverStatement(node, { contract: {} });
  return {
    ...,
    execute: [{ description: `create table "${this.tableName}"`, sql: statement.sql, params: statement.params }],
  };
}
```

The `Lowerer` → `DdlDriverLowerer` parameter type change matches what D2 did for PG — `DdlDriverLowerer` is the interface that has `lowerToDriverStatement`. Imported from `@prisma-next/family-sql/control-adapter`.

If a `step()` helper is used today, either widen it to accept a `params` field (preferred) or inline the object literal as shown. Match what D2 did for PG.

### 2. `SqliteOpFactoryCall` abstract base — verify D2 widening propagated

D2 widened the framework `OpFactoryCall.toOp` to allow `Op | Promise<Op>` return. The SQLite abstract base (`SqliteOpFactoryCallNode` or similar) should inherit this. Grep `abstract toOp` in `op-factory-call.ts` and verify the signature matches (it should already say `Op | Promise<Op>` or compatible). If it still says `: Op` only, widen it.

### 3. Other SQLite `*Call.toOp` methods stay sync

Every other concrete `*Call` subclass (`DropTableCall`, `RecreateTableCall`, `AddColumnCall`, `CreateIndexCall`, `RawSqlCall`, etc.) keeps its sync `toOp(): Op` body. They don't need `lowerToDriverStatement`. They just need their signature compatible with the widened abstract — which `Op` is, by structural narrowing.

### 4. Delete TML-2859 D5's expanded type-branching in the SQLite renderer

Where: `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts` (the `defaultVisitor.literal` body).

TML-2859 D5 added type-branching for `Date` / `boolean` / `bigint` / `null` / JSON-fallback. With D3 landing, `SqliteCreateTableCall.toOp` no longer goes through `lower()`'s renderer for literal defaults — `lowerToDriverStatement` handles them via codec encoding instead. The renderer's `defaultVisitor.literal` becomes unreachable on the live executable path. Delete the expanded type-branching body — the renderer doesn't need to inline literal defaults anymore.

**But verify before deleting**: grep for callers of `renderLoweredDdl` / `defaultVisitor` / `accept(defaultVisitor` in production code. If any production consumer still goes through `lower()` for DDL with literal defaults, the renderer needs to keep working. If only test code consumes it, the deletion is safe and the test updates accordingly.

**Wait — there's a subtle case.** The existing `lower()` method ALSO handles DDL ASTs (the renderer is what produces the `LoweredStatement.sql` for DDL). If any internal callers still use `lower()` for DDL paths post-D2/D3, their output now lacks the literal-default inlining. **Investigate before deleting**: if `lower()` is still being called for DDL by anything other than `lowerToDriverStatement` itself, leave the `defaultVisitor.literal` body intact and file a follow-up.

Practical guidance: most likely `defaultVisitor.literal` is only reached by `renderLoweredDdl`, which is only called by `lower()` for DDL nodes, which is only called by the legacy `*Call.toOp` consumers that D3 migrates. After D3 nothing reaches it. Confirm by grep and proceed.

### 5. The `sqliteDefaultToDdlColumnDefault` autoincrement guard stays

TML-2859 D5 added an `autoincrement()` short-circuit at the top of `sqliteDefaultToDdlColumnDefault` (in `issue-planner.ts`). That guard is codec-orthogonal — it suppresses synthesizing a `FunctionColumnDefault` for the `autoincrement()` magic string entirely (the inline `PRIMARY KEY AUTOINCREMENT` rendering is its own path). Leave it in place.

### 6. `planner-ddl-builders.ts`'s `renderDefaultLiteral` stays

Out of scope per spec — has Phase 2 consumers (`buildColumnDefaultSql` for `RecreateTableCall` / `AddColumnCall`) and a schema-verify hook caller (`sqliteRenderDefault` in `control-target.ts`).

### 7. The TML-2859 byte-parity oracle test

Where: `packages/3-targets/6-adapters/sqlite/test/migrations/create-table-call-byte-parity.test.ts`.

The test asserts SQLite `CreateTableCall.toOp(lowerer)` produces byte-identical output to the pre-slice `renderCreateTableSql` (the original SQLite planner string-builder). With D3, the call now goes through `lowerToDriverStatement` which uses codec encoding. For string defaults, the output should still match (string codec encoding produces the same wire form). For non-string defaults (`Date`, `bigint`, boolean, JSON), the codec-routed output is the NEW ground truth — likely differs from pre-slice for the broken cases.

**Adapt the test**: the test should now pin the codec-routed output. For each representative shape (string, boolean, Date, bigint, JSON-object), update the expected output to match what the codec produces. The pre-slice `renderCreateTableSql` oracle stays available for comparison but isn't the source of truth for non-text cases anymore.

A comment naming the property (NOT orchestration) helps: `// codec-routed output is the source of truth; pre-slice renderer's literal serialization was wrong for Date/bigint/jsonb (see TML-2867)`. (TML reference allowed since this is a known historical fact about the SQLite renderer.)

### 8. SQLite migration fixture regens

The fixtures that exercise SQLite migrations with literal defaults (`pnpm fixtures:check`) may regenerate. For `Date` defaults: ISO single-quoted output. For `boolean`: `0`/`1`. For `bigint`: bare numeric. For string: single-quoted. For JSON: JSON-stringified single-quoted. Accept the regens — that IS the bug fix.

**Halt if a regen produces output WORSE than pre-D3** (e.g. invalid SQL where pre-D3 was valid). Capture the diff.

## Completed when

- [ ] `SqliteCreateTableCall.toOp` is `async`, takes `DdlDriverLowerer`, delegates to `lowerer.lowerToDriverStatement`. The DDL execute step carries the returned `DriverStatement` shape.
- [ ] All other SQLite `*Call.toOp` methods (`DropTable`, `RecreateTable`, `AddColumn`, `CreateIndex`, `RawSql`, etc.) keep their sync bodies. They compile against the widened abstract.
- [ ] `SqliteOpFactoryCall` abstract base's `toOp` signature compatible with `Op | Promise<Op>` (D2 may already have done this — verify).
- [ ] TML-2859 D5's expanded type-branching in SQLite renderer's `defaultVisitor.literal` is DELETED (after grep-confirming no live executable path consumer remains). The `function` visitor (autoincrement) stays. The `quoteIdentifier`/`escapeLiteral` helpers stay.
- [ ] `sqliteDefaultToDdlColumnDefault` autoincrement guard stays (codec-orthogonal).
- [ ] `planner-ddl-builders.ts`'s `renderDefaultLiteral` stays (Phase 2 path + schema-verify hook).
- [ ] TML-2859 D5's `create-table-call-byte-parity.test.ts` adapts to the codec-routed output (the new ground truth for non-string defaults).
- [ ] `pnpm --filter @prisma-next/target-sqlite typecheck + test` green.
- [ ] `pnpm --filter @prisma-next/adapter-sqlite typecheck + test` green (D1's `lowerToDriverStatement` tests still pass; byte-parity test adapted).
- [ ] `pnpm typecheck` workspace-wide green.
- [ ] `pnpm test:packages` green.
- [ ] `pnpm fixtures:check` green (with the expected SQLite fixture regens for Date/bigint/jsonb cases accepted).
- [ ] `pnpm lint:deps` + `pnpm lint:casts` green.
- [ ] PG-side code untouched. `git diff main..HEAD -- packages/3-targets/3-targets/postgres/ packages/3-targets/6-adapters/postgres/` shows D1 + D2 commits only; no D3 changes.
- [ ] Runtime query path tests untouched and green.
- [ ] User-authoring shape in `examples/*/migrations/**/migration.ts` byte-for-byte unchanged.

## Halt conditions

- A PG file gets modified. **Halt** — D3 is SQLite-only.
- `lower()` / `LoweredStatement` / `LoweredParam` get modified. **Halt** — D1's constraint persists.
- A SQLite migration golden regenerates with output WORSE than pre-D3 (invalid SQL where pre-D3 produced valid SQL). **Halt** with the diff.
- The renderer's `defaultVisitor.literal` still has a live executable-path consumer post-D3. **Halt** — surface the consumer. The deletion is contingent on no live consumer.
- Runtime query path tests fail. **Halt** — the dispatch leaked.
- More than 20 files modified. **Halt**.
- 200+ tool calls without committing. **Halt**.

## Standing instruction

SQLite only. Do not touch PG. Do not touch the runtime query path. The codec-routed bug fix is what manifests through fixture regens for `Date` / `bigint` / `jsonb` default cases — accept the regens; they're the intended outcome.

## References

- **Spec:** [`../spec.md`](../spec.md).
- **Plan:** [`../plan.md`](../plan.md) § Dispatch 3.
- **D1 brief (substrate):** [`./01-async-interface-plumbing.md`](./01-async-interface-plumbing.md).
- **D2 brief (PG consumer rewire):** [`./02-pg-consumer-rewire.md`](./02-pg-consumer-rewire.md).
- **D1 commit:** `330dccc82`. **D2 commit:** `5728969ea`. **pgvector test adaptations:** `5661f5811`.
- **SQLite `CreateTableCall.toOp` site:** `packages/3-targets/3-targets/sqlite/src/core/migrations/op-factory-call.ts:141`.
- **SQLite renderer `defaultVisitor`:** `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts`.
- **TML-2859 byte-parity test:** `packages/3-targets/6-adapters/sqlite/test/migrations/create-table-call-byte-parity.test.ts`.

## Operational metadata

- **Model tier:** sonnet — mechanical refactor mirroring D2's PG pattern.
- **Time-box:** 90 min wall-clock.
- **Tool-call budget:** 200 max before committing intermediate state.

## Repo standing constraints

- Worktree: `/Users/wmadden/Projects/prisma/prisma-next/.claude/worktrees/adoring-swartz-9d66c0`.
- Branch: `tml-2867-codec-routed-ddl-defaults`. HEAD after D2 commit: `5728969ea`.
- `pnpm`, never `npm` / `npx`.
- No bare `as` casts in production code; tests exempt. Use `blindCast<T,'reason'>` if unavoidable.
- No TS import file extensions.
- No transient project refs in code or comments (TML refs allowed in commit messages only; the one allowed exception is the byte-parity test comment naming the codec-routed-output property — but try to phrase without TML if possible).

## Commit + sign-off

Commit on `tml-2867-codec-routed-ddl-defaults`. Sign off as `Will Madden <madden@prisma.io>`. End with `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`. Commit message describes the structural change (e.g. `SQLite CreateTableCall.toOp delegates to lowerToDriverStatement; renderer literal-default body deleted (codec-routed); byte-parity oracle test adapted`).
