# Slice: codec-routed-ddl-defaults — Dispatch plan

_(In-project slice. Spec: [`./spec.md`](./spec.md). Linear: [TML-2867](https://linear.app/prisma-company/issue/TML-2867). Pattern reference: TML-2859 slice 5 (the slice that surfaced the substrate gap) and TML-2754 slice 4 (the slice that introduced the type-branching shape).)_

## Shape

Three dispatches. Each is independent in the sense that its hand-off is a stable repo state; D2 and D3 are siblings that touch independent target packages, so they can run sequentially or in parallel from D1's hand-off.

### Dispatch 1: Async interface plumbing + codec resolver threading (no behaviour change)

- **Outcome:**
  - `DdlColumnDefaultVisitor<R>` interface methods return `Promise<R>` (in `packages/2-sql/4-lanes/relational-core/src/ast/ddl-types.ts`). `DdlColumnDefault.accept` signature still `R` (R becomes `Promise<string>` at use sites).
  - `Lowerer.lower()` interface returns `Promise<LoweredStatement>` (in `packages/2-sql/9-family/src/core/control-adapter.ts`).
  - Abstract `*Call.toOp()` returns `Promise<Op>` on both `PostgresOpFactoryCall` and `SqliteOpFactoryCall` base classes.
  - `LiteralColumnDefault` gains a required `codec: Codec<unknown, unknown>` constructor parameter and readonly field.
  - `IssuePlannerOptions` and `StrategyContext` on both targets gain a `codecLookup` field. The control adapter's `codecLookup` is read at `create*MigrationPlanner` time and threaded into `IssuePlannerOptions`.
  - `MigrationPlanWithAuthoringSurface.operations` getter becomes `getOperations(): Promise<Op[]>` (in `framework-components/control`). Both targets' `planner-produced-*-migration.ts` implementations adapt.
  - **All implementations stay sync.** Visitor methods wrap returns in `Promise.resolve(...)`. `Lowerer.lower` implementations stay sync internally, return `Promise.resolve(loweredStatement)`. `*Call.toOp()` methods stay sync internally. `defaultVisitor.literal` keeps the existing type-branching unchanged. The construction-time helpers `postgresDefaultToDdlColumnDefault` / `sqliteDefaultToDdlColumnDefault` accept the new `codec` parameter and pass it into `new LiteralColumnDefault(value, codec)` but the codec is unused by the renderer this dispatch.
  - All call sites of any of these add `await` to type-check. No fixture changes. No goldens regenerated. No behaviour change.
- **Builds on:** Today's main + TML-2859 (slice 5) merged. The substrate-fix scope is established; this dispatch makes the interfaces async-tolerant without changing what they do.
- **Hands to:** D2 and D3 (parallel sibling dispatches) — both can route the value through the codec at the renderer level without further interface plumbing.
- **Focus:** Pure mechanical async-ification + threading. No `await codec.encode` calls in renderer code yet. No deletion of existing type-branching. If a sync→async adaptation produces a non-obvious problem (the `MigrationPlanWithAuthoringSurface` change ripples to a consumer that isn't async), surface.

**Dispatch-INVEST check.** _Independent_ — no codec encode calls; D2 / D3 plug into the new interface shape. _Negotiable_ — outcome names the interfaces; implementer's grep finds the call sites. _Valuable_ — D2 / D3 can't compile without the async interfaces. _Estimable_ — binary: `pnpm typecheck` green across all packages with the new signatures; no behaviour change so all existing tests pass without modification. _Small_ — interface signature changes + mechanical `Promise.resolve` wrappers; the file count is large (because many call sites add `await`) but each change is one line. _Testable_ — `pnpm typecheck` + `pnpm test:packages` + `pnpm fixtures:check`; no goldens regenerated.

### Dispatch 2: PG renderer codec-routed default literals

- **Outcome:**
  - `defaultVisitor.literal` in `packages/3-targets/6-adapters/postgres/src/core/ddl-renderer.ts` rewritten to `async (node, ctx) => { if (node.value === null) return 'DEFAULT NULL'; const wire = await node.codec.encode(node.value, {}); const literalFragment = wireToDefaultLiteral(wire); return isTextLikeNativeType(ctx.nativeType) ? `DEFAULT ${literalFragment}` : `DEFAULT ${literalFragment}::${ctx.nativeType}`; }`. No `typeof value` branches. No `JSON.stringify`. The `isTextLikeNativeType` cast-suffix decision stays as it is.
  - New `wireToDefaultLiteral(wire: string | Uint8Array): string` helper in the same file: `string` → `'${escapeLiteral(wire)}'`; `Uint8Array` → `'\\xHEX'` (PG bytea hex literal). Throws on unexpected wire types.
  - `postgresDefaultToDdlColumnDefault` at `op-factory-call.ts:96` resolves the column's `Codec` from the threaded `codecLookup` + the column's storage type. Passes it into `new LiteralColumnDefault(value, codec)`. The caller (`toDdlColumn` in PG's `issue-planner.ts`) hands `codecLookup` down from `StrategyContext`.
  - The async chain — `renderColumn`, the `createTable` / `createSchema` visitor entries in `PostgresDdlVisitorImpl`, `renderLoweredDdl`, `PostgresControlAdapter.lower`, `PostgresCreateTableCall.toOp`, `PostgresCreateSchemaCall.toOp`, `renderOps`, and `PlannerProducedPostgresMigration.getOperations()` — actually `await` the downstream calls (vs D1's `Promise.resolve` stubs).
  - PG-side update of `MigrationPlanWithAuthoringSurface.getOperations()` to eagerly await all `*Call.toOp()` materializations.
  - Byte-parity proof: extend `packages/3-targets/6-adapters/postgres/test/migrations/` with at least 3 cases that pin codec-vs-pre-codec equivalence for `boolean`, `Date`, `bigint` defaults (the cases the pre-codec implementation got wrong). The `::jsonb` cast test from TML-2861 stays green unchanged.
- **Builds on:** D1's hand-off.
- **Hands to:** D3 (independent sibling — touches SQLite). The PG renderer becomes the structural oracle for D3's SQLite mirror.
- **Focus:** PG only. Do NOT touch SQLite renderer. Do NOT touch SQLite's `*Call`. The change is self-contained to the PG target package's renderer + the upstream codec threading on the PG side.

**Dispatch-INVEST check.** _Independent_ — touches PG renderer + PG planner construction; SQLite untouched. _Negotiable_ — outcome named (replace type-branching with codec; add wire-helper); implementer determines exact codec-lookup mechanism from the threaded resolver. _Valuable_ — PG defaults that today produce invalid SQL (Date, bigint) now emit correct SQL via the codec; the goldens for those cases (if any exist) update accordingly. _Estimable_ — binary: zero `typeof value === 'boolean' | 'number'` branches in the file; explicit codec call; byte-parity test for boolean/Date/bigint passes. _Small_ — single file change for the renderer; one upstream change in `op-factory-call.ts` + `issue-planner.ts` + `planner-strategies.ts` to thread the codec. _Testable_ — `pnpm --filter @prisma-next/adapter-postgres typecheck + test`, `pnpm --filter @prisma-next/target-postgres typecheck + test`, `pnpm fixtures:check`, new boolean/Date/bigint byte-parity tests.

### Dispatch 3: SQLite renderer codec-routed default literals + TML-2859 D5 roll-back

- **Outcome:**
  - `defaultVisitor.literal` in `packages/3-targets/6-adapters/sqlite/src/core/ddl-renderer.ts` rewritten to the codec-routed form (mirror PG; SQLite has no `::nativeType` cast suffix so the conditional collapses to `\`DEFAULT ${literalFragment}\``). The D5-added type-branching (boolean → `0`/`1`, Date → ISO single-quoted, bigint → `String(value)`, JSON fallback) is **deleted** — the codec produces the canonical wire form.
  - New SQLite `wireToDefaultLiteral(wire: string | Uint8Array): string` helper: `string` → `'${escapeLiteral(wire)}'`; `Uint8Array` → `X'HEX'` (SQLite blob literal). Throws on unexpected wire types.
  - `sqliteDefaultToDdlColumnDefault` at `issue-planner.ts:272` resolves the column's `Codec` from the threaded `codecLookup` and passes it into `new LiteralColumnDefault(value, codec)`. The autoincrement guard (D5) stays — it's codec-orthogonal.
  - The async chain — `renderColumn`, the `createTable` visitor entry in `SqliteDdlVisitorImpl`, `renderLoweredDdl`, `SqliteControlAdapter.lower`, `SqliteCreateTableCall.toOp`, `renderOps`, and `PlannerProducedSqliteMigration.getOperations()` — actually `await` the downstream calls.
  - SQLite-side update of `MigrationPlanWithAuthoringSurface.getOperations()` to eagerly await `*Call.toOp()`.
  - Byte-parity proof: the TML-2859 cross-implementation byte-parity test in `packages/3-targets/6-adapters/sqlite/test/migrations/create-table-call-byte-parity.test.ts` stays green (the test's oracle is the pre-slice `renderCreateTableSql` from `operations/tables.ts`, which type-branches its OWN way — so codec equivalence has to match `renderCreateTableSql`'s output for the 7 literal-default kinds the test pins). If `renderCreateTableSql`'s output for boolean / Date / bigint disagrees with the codec's wire form, the oracle is the *codec* (the pre-slice path's output was wrong on those types — that's the bug TML-2867 fixes); update the test's representative-shape cases to expect the codec-produced output and note the deliberate divergence in a comment that names the property (not orchestration).
  - `planner-ddl-builders.ts`'s `renderDefaultLiteral` STAYS (still called by `buildColumnDefaultSql` for Phase 2 flat-spec, and `sqliteRenderDefault` for the schema-verify hook). Not in scope.
- **Builds on:** D1's hand-off. Optionally builds on D2's structural pattern as the oracle (the SQLite renderer's shape mirrors what D2 lands on PG).
- **Hands to:** Slice DoD. The slice's named outcomes are achieved on both targets.
- **Focus:** SQLite only. Do NOT touch PG (D2 owns that). Do NOT migrate other SQLite `*Call` classes. Do NOT delete `renderDefaultLiteral`.

**Dispatch-INVEST check.** _Independent_ — touches SQLite renderer + SQLite planner construction; PG untouched. _Negotiable_ — outcome named (replace type-branching + delete D5 expansion + add wire-helper). _Valuable_ — closes the slice DoD on the SQLite side; deletes the D5 transitional state. _Estimable_ — binary: zero `typeof value` branches in `defaultVisitor.literal`; explicit codec call; byte-parity test passes for all 7 literal-default kinds. _Small_ — single file change for the renderer; one upstream change in `issue-planner.ts` + `planner-strategies.ts`. _Testable_ — `pnpm --filter @prisma-next/adapter-sqlite typecheck + test`, `pnpm --filter @prisma-next/target-sqlite typecheck + test`, `pnpm fixtures:check`, existing byte-parity test + boolean/Date/bigint cases adjusted to the codec's output.

## Handoff contract — linearity + DoD completeness

- **Linearity.** D1 is a strict prerequisite for D2 and D3 (the async interfaces and the `codec` field on `LiteralColumnDefault` are needed by both). D2 and D3 are independent siblings — touching different target packages. They can run in parallel (different worktrees) or sequentially (D2 first as the structural oracle for D3).
- **DoD completeness.** The slice spec lists eight DoD items:
  1. _Zero `typeof value === 'boolean'` matches in either renderer's `ddl-renderer.ts`._ → satisfied jointly by **D2** (PG) + **D3** (SQLite).
  2. _`LiteralColumnDefault` carries a required `codec` field; construction-time helpers populate it._ → satisfied by **D1** (field) + **D2/D3** (helpers thread codec).
  3. _Both `defaultVisitor.literal` impls call `codec.encode` and emit via `wireToDefaultLiteral`. No JSON.stringify fallback. No JS-value type-branching._ → satisfied by **D2** (PG) + **D3** (SQLite).
  4. _DDL render chain async end-to-end through `*Call.toOp(lowerer)`. `Lowerer.lower` returns `Promise<LoweredStatement>`. `MigrationPlanWithAuthoringSurface.getOperations()` returns `Promise<Op[]>`._ → satisfied by **D1** (signatures) + **D2/D3** (actually-async implementations).
  5. _Target-specific `wireToDefaultLiteral` helpers handle string and Uint8Array; throw on unexpected wire types._ → satisfied by **D2** (PG) + **D3** (SQLite).
  6. _TML-2861's `::jsonb` / `::json` cast behaviour preserved._ → satisfied by **D2** (cast-suffix logic untouched; test stays green).
  7. _TML-2859 D5's expanded type-branching in SQLite `defaultVisitor.literal` is deleted._ → satisfied by **D3**.
  8. _`pnpm fixtures:check` green; goldens unchanged unless codec equivalence forces a deliberate update for boolean/Date/bigint cases._ → satisfied at the end of **D3** (final integration point); if D2's PG path forces a fixture regen, the regen lands in D2 with a comment that names the property.

## Halt conditions (shared across dispatches)

- A consumer of `MigrationPlanWithAuthoringSurface.operations` lives outside async context — surface (the spec asserts all consumers are already async based on the Plan agent's enumeration; if that's wrong, the change shape needs to adjust).
- A codec implementation in the repo returns something other than `string` / `Uint8Array` from `encode()` — surface (the spec asserts no such codec ships; if one does, the `wireToDefaultLiteral` contract needs widening).
- `codecLookup` resolution at IR-construction time can't find a codec for a column's storage type — surface; the spec assumes every column has a registered codec.
- More than 15 source files modified in any single dispatch — surface (the change is structural but each dispatch should stay close to the named file count).

## Operational metadata

- **Reviewer pass after the slice DoD:** opus-high.
- **Implementer model tier per dispatch:** sonnet-mid (mechanical refactors + interface plumbing).
- **Time-box per dispatch:** 90 minutes.
