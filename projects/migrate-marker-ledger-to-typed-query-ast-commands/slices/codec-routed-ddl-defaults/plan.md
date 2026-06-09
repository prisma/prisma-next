# Slice: codec-routed-ddl-defaults — Dispatch plan

_(In-project slice. Spec: [`./spec.md`](./spec.md). Linear: [TML-2867](https://linear.app/prisma-company/issue/TML-2867). Pattern reference: Mongo's `MigrationStep.command: AnyMongoDdlCommand` shape — the SQL family was supposed to look like this and didn't.)_

## Shape

Three dispatches. D1 is the substrate (new type + new adapter method on both targets). D2 and D3 are sibling consumer-side changes (one per target), unblocked by D1 and parallelisable.

### Dispatch 1: Define `DriverExecutableStatement` + `lowerForControl` on both adapters

- **Outcome:**
  - Define and export `DriverExecutableStatement` type from `@prisma-next/family-sql` (or wherever the existing `Lowerer` / `LoweredStatement` types live — co-locate with them). Shape: `{ readonly sql: string; readonly params: readonly unknown[] }` with the contract that `params` are codec-encoded wire values (driver-ready, no further transformation).
  - Extend `SqlControlAdapter<TTarget>` (and the `Lowerer` interface it satisfies, if appropriate) with a new method: `lowerForControl(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): Promise<DriverExecutableStatement>`.
  - Implement `lowerForControl` on `PostgresControlAdapter` and `SqliteControlAdapter`. Implementation calls the existing sync `lower(ast, ctx)` to get the LoweredStatement, then for each `{kind: 'literal', value}` in params resolves the column's codec (via the adapter's existing `codecLookup`) and `await codec.encode(value, {})`. For each codec-encoded param, dispatch on grammar position: parameterizable → leave `$N` in `sql`, include wire value in output `params`; must-inline → substitute the wire value into `sql` as an inline literal (with quoting + cast suffix), omit from output `params`.
  - The grammar-position dispatch needs a mechanism. Easiest: extend `LoweredParam` with an optional `inlineRequired?: boolean` flag the renderer sets when emitting in must-inline positions (DDL `DEFAULT` clauses). The renderer change is small (the existing `defaultVisitor.literal` switches from "type-branch and inline" to "emit `$N` placeholder + add `{kind:'literal', value, inlineRequired: true}` to params"). `lowerForControl` reads the flag.
  - Inline substitution logic (target-specific): PG handles `string` wire as `'${escape}'::${nativeType}` (with `isTextLikeNativeType` suppressing the cast for text-like types — moved from TML-2861 into here); PG handles `Uint8Array` as `'\\xHEX'::bytea`. SQLite handles `string` as `'${escape}'`; SQLite handles `Uint8Array` as `X'HEX'`. SQLite has no cast suffix (no `::type` syntax). The substitution helper is target-specific, lives in each adapter package.
  - Renderer cleanup: PG `defaultVisitor.literal` and SQLite `defaultVisitor.literal` both stop type-branching on the JS value. They emit `$N` (or whatever placeholder mechanism the dispatch chooses) and add the literal param with `inlineRequired: true`. The hand-rolled `typeof value === 'boolean'` / `JSON.stringify(value)` branches are deleted on both targets. TML-2859 D5's expanded type-branching in SQLite goes away as part of this.
  - No `*Call.toOp()` changes yet (D2 / D3). No `MigrationPlan*` interface changes yet (D2 / D3). The substrate is in place; consumers haven't been wired up.
- **Builds on:** TML-2859 (slice 5 / PR #768) merged so the SQLite `*Call` shape is in place. If slice 5 isn't merged when D1 starts, D1 rebases.
- **Hands to:** D2 + D3 (parallel) — each target can rewire its `*Call.toOp` calls onto the new adapter method.
- **Focus:** Substrate only. No consumer changes. The existing `*Call.toOp` calls keep going through the old sync `lower()` path during D1; the renderer's literal-default path is the one that changes (it now emits parameterized SQL with must-inline flags instead of inlining values). Existing migration goldens / fixtures may regenerate for `Date` / `bigint` / `jsonb` defaults — that's the bug fix manifesting; capture the regen in the dispatch summary.

**Dispatch-INVEST.** _Independent_ — the substrate doesn't touch the consumer (D2/D3 own that). _Negotiable_ — the brief names the contracts; implementer chooses the placeholder-marker mechanism. _Valuable_ — D2/D3 cannot start without the adapter method existing. _Estimable_ — binary: the method exists on both adapters, the renderer stops type-branching, fixtures regenerate correctly for the bug-fixed cases, runtime path untouched. _Small_ — substrate-only, contained to family-sql + both adapter packages + both renderer files. _Testable_ — adapter-level tests for `lowerForControl` covering string / Date / bigint / Uint8Array / null literal defaults across PG and SQLite. Existing renderer tests pin the parameterized-SQL-with-must-inline-flag intermediate output.

### Dispatch 2: PG `*Call.toOp` rewires to `lowerForControl`; consumers add `await Promise.all`

- **Outcome:**
  - `PostgresOpFactoryCall` abstract base widens `toOp()` return type to `MigrationPlanOperation | Promise<MigrationPlanOperation>`.
  - `PostgresCreateTableCall.toOp` becomes `async`, calls `await lowerer.lowerForControl(node, ctx)` instead of `lowerer.lower(node, ctx)`. Wraps the returned `DriverExecutableStatement` into the migration op's `execute[0]`.
  - `PostgresCreateSchemaCall.toOp` same shape.
  - Every other `PostgresOpFactoryCall` subclass keeps its existing sync `toOp()` body.
  - `MigrationPlanWithAuthoringSurface.operations` and `MigrationPlan.operations` framework interfaces widen to `readonly (MigrationPlanOperation | Promise<MigrationPlanOperation>)[]` at `framework-components/src/control/control-migration-types.ts`. Both PG `PlannerProducedPostgresMigration` and the framework `Migration` base class adapt return types — bodies unchanged (no async work on the sync side; the array just happens to contain promises now).
  - PG-side consumers add `await Promise.all(...)`: `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts` (sites at ~97, 165, 220, 637), `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts` (sites at ~692, 697), and any other live-instance accessor surfaced by grep.
  - Framework-side: `synth.ts` (~121, 131) gets `await Promise.all(synthedPlan.operations)` once near the start, then iterates the materialized array.
  - `stripOperations` (find it; it's the serialization step that lives somewhere on the framework or planner-strategies path) awaits all promises before serializing.
- **Builds on:** D1's hand-off — `lowerForControl` exists on PG adapter; the renderer produces parameterized-with-must-inline SQL.
- **Hands to:** Slice DoD on the PG side. D3 owns the SQLite mirror.
- **Focus:** PG only. Don't touch SQLite. The framework interface widening DOES land here because it's a cross-target change (both targets' planner-produced migrations satisfy it); the widening lands in D2 and D3 inherits the change.

**Dispatch-INVEST.** _Independent_ — touches PG `*Call`s + the framework interface + PG-side consumers. _Negotiable_ — outcome named (async `toOp` + delegate; widen framework type; await at consumption boundaries). _Valuable_ — fixes PG codec-routed defaults; consumers adapted. _Estimable_ — binary: PG migration goldens green (or regenerated for the bug-fixed cases); runner / synth / planner-strategies test suites green. _Small_ — ~10-15 files. _Testable_ — full PG migration suite + integration tests.

### Dispatch 3: SQLite `*Call.toOp` rewires to `lowerForControl`; SQLite consumers add `await Promise.all`

- **Outcome:**
  - Mirror D2 on SQLite. `SqliteOpFactoryCall.toOp` return type already widened by D2's framework-interface change. `SqliteCreateTableCall.toOp` becomes async, delegates to `lowerForControl`.
  - SQLite-side consumers add `await Promise.all(...)`: `packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts` (sites at ~60, 125, 246, 615, 617).
  - TML-2859 D5's leftover type-branching in SQLite renderer is already deleted by D1. TML-2859 D5's autoincrement guard in `sqliteDefaultToDdlColumnDefault` stays (it's codec-orthogonal).
  - `planner-ddl-builders.ts`'s `renderDefaultLiteral` stays — out of scope per spec (Phase 2 flat-spec path + schema-verify hook callers).
- **Builds on:** D1 (adapter substrate) + D2 (framework interface widening + general consumer-await pattern proven on PG).
- **Hands to:** Slice DoD on the SQLite side. Slice complete.
- **Focus:** SQLite only. Mechanical mirror of D2 modulo the dialect differences (no cast suffix, different blob literal syntax — both already handled in D1's adapter).

**Dispatch-INVEST.** _Independent_ — touches SQLite `*Call`s + SQLite-side consumers. Framework interface unchanged in D3 (D2 landed that). _Negotiable_ — same outcome shape as D2. _Valuable_ — closes the slice's named outcome on both targets. _Estimable_ — binary: SQLite migration suite green; byte-parity oracle test (TML-2859 D5's `create-table-call-byte-parity.test.ts`) adapts to the codec-routed output (the test's intent — "the path matches pre-slice byte-for-byte" — needs adjustment because the codec-routed output is the new ground truth; update the test's expected values once and pin those forward). _Small_ — ~5-10 files. _Testable_ — full SQLite migration suite + integration tests + the byte-parity oracle test with updated expectations.

## Handoff contract — linearity + DoD completeness

- **Linearity.** D1 is a strict prerequisite for D2 and D3. D2 and D3 are independent siblings. They can run sequentially or in parallel from D1's hand-off; if parallel, the framework interface widening that lands in D2 needs to merge before D3 starts (or be carved into its own micro-dispatch).
- **DoD completeness.** Spec lists eight DoD items:
  1. _`DriverExecutableStatement` defined + exported._ → **D1**.
  2. _`lowerForControl` exists on both adapters._ → **D1**.
  3. _`SqlMigrationPlanOperationStep` embeds the type; `params` non-optional + wire-encoded._ → **D2** (when PG's `*Call.toOp` populates the new shape; SQLite inherits the type change).
  4. _Three DDL-lowering `*Call`s become async + delegate._ → **D2** (PG `CreateTableCall` + `CreateSchemaCall`) and **D3** (SQLite `CreateTableCall`).
  5. _`*Call.toOp` abstract widens to `Op | Promise<Op>`._ → **D2** (framework-side change).
  6. _Framework `MigrationPlan(WithAuthoringSurface).operations` widens._ → **D2**.
  7. _Consumers add `await Promise.all`._ → **D2** (PG + framework consumers) and **D3** (SQLite consumers).
  8. _Renderer `defaultVisitor.literal` stops type-branching._ → **D1**.

## Halt conditions (shared)

- The grammar-position dispatch mechanism turns out non-trivial — e.g. the renderer can't easily distinguish parameterizable vs must-inline positions because some positions are conditional on dialect grammar in ways the renderer doesn't currently model. Surface; design the mechanism explicitly before proceeding.
- A codec implementation returns a wire type outside `string | Uint8Array | number | bigint` and the inline-substitution helper doesn't know how to format it as a SQL literal. Surface with the codec name; either constrain the codec's wire type or widen the helper.
- The runtime query path's existing tests fail (`pnpm test:packages` on `relational-core`, `sql-runtime`, etc.). The slice should NOT touch the runtime path — if a test fails there, D1 leaked into territory it shouldn't have. Surface.
- A migration golden regenerates in a way that suggests a bug (output worse than what the broken type-branching produced for a case where the broken output happened to be valid). Surface the diff; the slice expects regens only for `Date` / `bigint` / `jsonb` default cases where the codec-routed output is the correct one.
- More than 25 source files modified in any single dispatch — surface; the change should fit within the per-dispatch budget.

## Operational metadata

- **Reviewer pass after slice DoD:** opus-high.
- **Implementer model tier per dispatch:** sonnet (mechanical refactor + adapter implementation).
- **Time-box per dispatch:** 90 min wall-clock; surface if not done at 90 min.
- **Tool-call budget per dispatch:** 200 max before committing intermediate state.
