# Slice: codec-routed-ddl-defaults — Dispatch plan

_(In-project slice. Spec: [`./spec.md`](./spec.md). Linear: [TML-2867](https://linear.app/prisma-company/issue/TML-2867). Pattern reference: Mongo's `MigrationStep.command: AnyMongoDdlCommand` shape — the SQL family was supposed to look like this and didn't.)_

## Shape

Three dispatches. D1 is purely additive substrate (new type + new adapter method on both targets); the existing `lower()` and renderer are byte-for-byte unchanged. D2 and D3 are sibling consumer-side changes (one per target) that migrate `*Call.toOp` onto the new method and clean up the renderer's now-dead literal-default code.

### Dispatch 1: Define `DriverStatement` + `lowerToDriverStatement` on both adapters (purely additive)

- **Outcome:**
  - Define and export `DriverStatement` type from `@prisma-next/family-sql` (or wherever the existing `Lowerer` / `LoweredStatement` types live — co-locate with them). Shape: `{ readonly sql: string; readonly params: readonly unknown[] }` with the contract that `params` are codec-encoded wire values (driver-ready, no further transformation).
  - Extend `SqlControlAdapter<TTarget>` with a new method: `lowerToDriverStatement(ast: AnyQueryAst | DdlNode, context: LowererContext<unknown>): Promise<DriverStatement>`.
  - Implement `lowerToDriverStatement` on `PostgresControlAdapter` and `SqliteControlAdapter`. The implementation walks the AST and produces `DriverStatement` directly — does NOT call `lower()` and does NOT share output with it. Internally it resolves the column's codec for each literal default (via the adapter's existing `codecLookup` keyed by native type), `await`s `codec.encode(value, {})` to get the wire value, then either substitutes inline (with proper quoting + PG cast suffix) when grammar requires or keeps as `$N` + params entry otherwise.
  - How the implementation shares code with the existing renderer is the implementer's call — could be a separate parameterized visitor, a fork of the existing visitor, a different mechanism entirely. The public contract is the input/output shape.
  - PG-specific inline substitution helper handles wire shapes: `string` → `'${escape}'` then `::${nativeType}` when not text-like (the TML-2861 `isTextLikeNativeType` decision reimplemented inside `lowerToDriverStatement`); `Uint8Array` → `'\\xHEX'::bytea`; `number`/`bigint` → bare numeric; `boolean` → bare `true`/`false`; objects → JSON-stringified + quoted + cast. Throws on unexpected wire shapes.
  - SQLite-specific inline substitution helper: `string` → `'${escape}'`; `Uint8Array` → `X'HEX'`; `number`/`bigint` → bare numeric; `boolean` → `0`/`1` (SQLite has no boolean type); throws on unexpected.
  - **The existing renderer (`packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts`, `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts`) is bit-for-bit unchanged.** Its `defaultVisitor.literal` keeps its existing hand-rolled type-branching body. The TML-2861 `isTextLikeNativeType` helper stays in `ddl-renderer.ts`. TML-2859 D5's expanded type-branching in SQLite stays.
  - **The existing `lower()` method on both adapters is bit-for-bit unchanged.** No new helpers called from `lower()`. No materialization. No wrapping. Nothing.
  - **`LoweredStatement` and `LoweredParam` shapes are unchanged.** No new fields, no extensions. The new mechanism is self-contained in `lowerToDriverStatement` and doesn't leak through `LoweredStatement`.
  - Adapter-level tests for `lowerToDriverStatement` covering string / Date / bigint / Uint8Array / null / boolean / number / JSON-object literal defaults across PG and SQLite, asserting the returned SQL has the wire value substituted inline correctly (PG with cast suffix where required; SQLite without). Tests assert that the existing `lower()` output is unaffected.
- **Builds on:** TML-2859 (slice 5 / PR #768) merged so the SQLite `*Call` shape is in place. If slice 5 isn't merged when D1 starts, D1 rebases.
- **Hands to:** D2 + D3 (parallel) — each target can rewire its `*Call.toOp` calls onto the new adapter method.
- **Focus:** Purely additive. No changes to `lower()`, no changes to the existing renderer, no changes to `LoweredStatement`/`LoweredParam`, no changes to `*Call.toOp` bodies, no changes to consumers. Existing behaviour (including the broken Date/bigint inlining for Date defaults) is preserved exactly. The bug stays unfixed in D1.

**Dispatch-INVEST.** _Independent_ — purely additive; no consumers touched; the existing pipeline runs exactly as it does today. _Negotiable_ — the brief names the contract; implementer chooses how `lowerToDriverStatement` is implemented internally. _Valuable_ — D2/D3 cannot start without the adapter method existing. _Estimable_ — binary: type exists, method exists on both adapters, adapter-level tests pin the codec-routed output for each wire-type shape, existing renderer tests + existing `lower()` consumers unaffected. _Small_ — substrate-only, contained to family-sql + both adapter packages. _Testable_ — adapter-level tests for `lowerToDriverStatement` + `pnpm typecheck` + `pnpm test:packages` + `pnpm fixtures:check` (which should NOT regenerate any goldens because consumers haven't migrated).

### Dispatch 2: PG `*Call.toOp` rewires to `lowerToDriverStatement`; framework interface widens; PG + framework consumers add `await Promise.all`

- **Outcome:**
  - `PostgresOpFactoryCall` abstract base widens `toOp()` return type to `MigrationPlanOperation | Promise<MigrationPlanOperation>`.
  - `PostgresCreateTableCall.toOp` becomes `async`, calls `await lowerer.lowerToDriverStatement(node, ctx)` instead of `lowerer.lower(node, ctx)`. Wraps the returned `DriverStatement` into the migration op's `execute[0]`.
  - `PostgresCreateSchemaCall.toOp` same shape.
  - Every other `PostgresOpFactoryCall` subclass keeps its existing sync `toOp()` body.
  - `MigrationPlanWithAuthoringSurface.operations` and `MigrationPlan.operations` framework interfaces widen to `readonly (MigrationPlanOperation | Promise<MigrationPlanOperation>)[]` at `framework-components/src/control/control-migration-types.ts`. Both PG `PlannerProducedPostgresMigration` and the framework `Migration` base class adapt return types — bodies unchanged (no async work on the sync side; the array just happens to contain promises now).
  - PG-side consumers add `await Promise.all(...)`: `packages/3-targets/3-targets/postgres/src/core/migrations/runner.ts` (sites at ~97, 165, 220, 637), `packages/3-targets/3-targets/postgres/src/core/migrations/planner-strategies.ts` (sites at ~692, 697), and any other live-instance accessor surfaced by grep.
  - Framework-side: `synth.ts` (~121, 131) gets `await Promise.all(synthedPlan.operations)` once near the start, then iterates the materialized array.
  - `stripOperations` (find it; it's the serialization step that lives somewhere on the framework or planner-strategies path) awaits all promises before serializing.
- **Builds on:** D1's hand-off — `lowerToDriverStatement` exists on PG adapter.
- **Hands to:** Slice DoD on the PG side. D3 owns the SQLite mirror.
- **Focus:** PG only. Don't touch SQLite. The framework interface widening lands here because it's a cross-target change (both targets' planner-produced migrations satisfy it); the widening lands in D2 and D3 inherits the change.

**Dispatch-INVEST.** _Independent_ — touches PG `*Call`s + the framework interface + PG-side consumers. _Negotiable_ — outcome named (async `toOp` + delegate; widen framework type; await at consumption boundaries). _Valuable_ — fixes PG codec-routed defaults; consumers adapted. _Estimable_ — binary: PG migration goldens regenerate for Date/bigint/jsonb defaults to the codec-routed correct form; runner / synth / planner-strategies test suites green. _Small_ — ~10-15 files. _Testable_ — full PG migration suite + integration tests; the goldens that regenerate are the bug fix manifesting.

### Dispatch 3: SQLite `*Call.toOp` rewires to `lowerToDriverStatement`; SQLite consumers add `await Promise.all`; renderer cleanup

- **Outcome:**
  - `SqliteOpFactoryCall.toOp` return type already widened by D2's framework-interface change. `SqliteCreateTableCall.toOp` becomes async, delegates to `lowerToDriverStatement`.
  - SQLite-side consumers add `await Promise.all(...)`: `packages/3-targets/3-targets/sqlite/src/core/migrations/runner.ts` (sites at ~60, 125, 246, 615, 617).
  - **Renderer cleanup** — once the live executable path on both targets goes through `lowerToDriverStatement`, the renderer's `defaultVisitor.literal` is no longer reached for the codec-encoded payload path. TML-2859 D5's expanded type-branching in SQLite's renderer is deleted. PG's renderer keeps its current `defaultVisitor.literal` body **only if** something still reaches it through `lower()` for DDL paths (the runtime path doesn't render DDL); grep confirms whether anything does. If nothing reaches it, delete. If something does, leave it and file a follow-up.
  - TML-2859 D5's autoincrement guard in `sqliteDefaultToDdlColumnDefault` (in `issue-planner.ts`) stays — it's codec-orthogonal.
  - `planner-ddl-builders.ts`'s `renderDefaultLiteral` stays — out of scope per spec (Phase 2 flat-spec path + schema-verify hook callers).
- **Builds on:** D1 (adapter substrate) + D2 (framework interface widening + general consumer-await pattern proven on PG).
- **Hands to:** Slice DoD on the SQLite side. Slice complete.
- **Focus:** SQLite only. Mechanical mirror of D2 modulo the dialect differences (no cast suffix, different blob literal syntax — both already handled in D1's adapter).

**Dispatch-INVEST.** _Independent_ — touches SQLite `*Call`s + SQLite-side consumers + renderer cleanup. Framework interface unchanged in D3 (D2 landed that). _Negotiable_ — same outcome shape as D2. _Valuable_ — closes the slice's named outcome on both targets. _Estimable_ — binary: SQLite migration suite green; byte-parity oracle test (TML-2859 D5's `create-table-call-byte-parity.test.ts`) adapts to the codec-routed output. _Small_ — ~5-10 files. _Testable_ — full SQLite migration suite + integration tests + the byte-parity oracle test with updated expectations.

## Handoff contract — linearity + DoD completeness

- **Linearity.** D1 is a strict prerequisite for D2 and D3. D2 and D3 are independent siblings. They can run sequentially or in parallel from D1's hand-off; if parallel, the framework interface widening that lands in D2 needs to merge before D3 starts (or be carved into its own micro-dispatch).
- **DoD completeness.** Spec lists ten DoD items:
  1. _`DriverStatement` defined + exported._ → **D1**.
  2. _`lowerToDriverStatement` exists on both adapters._ → **D1**.
  3. _Existing `Lowerer.lower`, `LoweredStatement`, `LoweredParam`, renderer `defaultVisitor.literal` bit-for-bit unchanged after D1._ → **D1**.
  4. _`SqlMigrationPlanOperationStep` embeds `DriverStatement`; `params` non-optional + wire-encoded._ → **D2** (PG `*Call.toOp` populates the new shape; SQLite inherits the type change).
  5. _Three DDL-lowering `*Call`s become async + delegate._ → **D2** (PG `CreateTableCall` + `CreateSchemaCall`) and **D3** (SQLite `CreateTableCall`).
  6. _`*Call.toOp` abstract widens to `Op | Promise<Op>`._ → **D2** (framework-side change).
  7. _Framework `MigrationPlan(WithAuthoringSurface).operations` widens._ → **D2**.
  8. _Consumers add `await Promise.all`._ → **D2** (PG + framework consumers) and **D3** (SQLite consumers).
  9. _TML-2859 D5 expanded type-branching in SQLite renderer deleted._ → **D3**.
  10. _User-authoring shape byte-for-byte unchanged._ → **D1/D2/D3** — verifiable by `git diff` of `examples/*/migrations/**/migration.ts` (expect zero changes).

## Halt conditions (shared)

- D1 attempts to touch `lower()`, the renderer's `defaultVisitor.literal`, `LoweredStatement`, or `LoweredParam`. **Halt.** D1 is purely additive; these are off-limits.
- A codec implementation returns a wire type outside `string | Uint8Array | number | bigint | boolean | object` (where object is JSON-stringifiable) and the inline-substitution helper doesn't know how to format it. Surface with the codec name; either constrain the codec or widen the helper.
- The runtime query path tests fail. The slice should NOT touch that path — if a test fails there, the dispatch leaked. Surface.
- A migration golden regenerates during D1 (D1 doesn't migrate consumers, so nothing should regenerate). Surface — something leaked.
- More than 25 source files modified in any single dispatch — surface; the change should fit within the per-dispatch budget.

## Operational metadata

- **Reviewer pass after slice DoD:** opus-high.
- **Implementer model tier per dispatch:** sonnet (mechanical refactor + adapter implementation).
- **Time-box per dispatch:** 90 min wall-clock; surface if not done at 90 min.
- **Tool-call budget per dispatch:** 200 max before committing intermediate state.
