# Task spec — Phase 0: Pure factory extraction

## Summary

Refactor `packages/3-targets/3-targets/postgres/src/core/migrations/operation-resolver.ts` (929 LOC) in place so that every `resolveX(descriptor, context)` function is split into:

1. A **pure** `createX(...literalArgs): SqlMigrationPlanOperation<PostgresPlanTargetDetails>` with no `OperationResolverContext`, no codec hook access, no `db` handle — every dependency is passed as a literal argument.
2. A **thin** `resolveX(descriptor, context)` wrapper that performs the context-dependent materialization (contract lookup, codec expansion, schema qualification, default rendering) and then calls the pure `createX`.

One-to-many resolvers split into multiple pure factories, each returning exactly one operation.

**Descriptor flow continues to work identically throughout.** This is a behavior-preserving refactor; the only external change is that pure factories become available as building blocks for Phase 1.

Phase 0 introduces no new types or helpers outside the factory extraction itself. The `dataTransform` placeholder machinery (the AST node hierarchy for scaffolded `check` / `run` bodies) is Phase 1's concern and is not touched here.

## Why

- Phase 1 needs a 1:1 mapping from `OpFactoryCall` class to pure factory. Doing the extraction first makes Phase 1 a wiring exercise instead of a wiring + refactor exercise.
- Today's descriptor-flow tests pass through `resolveX`, which now delegates to `createX`. If Phase 0 lands with all tests green, we can be confident the pure factories are correct before we build new infrastructure on top.

## Scope

### File moves

- New file: `packages/3-targets/3-targets/postgres/src/core/migrations/op-factories.ts` (default export: none; named exports: every `createX`).
- `operation-resolver.ts` stays in place for Phase 0. It now contains only the thin `resolveX` wrappers. It is deleted in Phase 5.

### `createX` inventory (one per operation class)

Every `SqlMigrationPlanOperation` that `operation-resolver.ts` produces gets a pure factory. Expected list (final list confirmed by the author against `operation-resolver.ts`):

- `createTable(schemaName, tableName, columns: ReadonlyArray<ColumnSpec>, options?): Op`
- `dropTable(schemaName, tableName): Op`
- `addColumn(schemaName, tableName, columnSpec: ColumnSpec): Op`
- `dropColumn(schemaName, tableName, columnName): Op`
- `alterColumnType(schemaName, tableName, columnName, newType, using?: SqlExpression): Op`
- `setNotNull(schemaName, tableName, columnName): Op`
- `dropNotNull(schemaName, tableName, columnName): Op`
- `setDefault(schemaName, tableName, columnName, defaultExpr): Op`
- `dropDefault(schemaName, tableName, columnName): Op`
- `addPrimaryKey(schemaName, tableName, columns, constraintName): Op`
- `addForeignKey(schemaName, tableName, constraintSpec: ForeignKeySpec): Op`
- `addUnique(schemaName, tableName, columns, constraintName): Op`
- `createIndex(schemaName, tableName, indexSpec: IndexSpec): Op`
- `dropIndex(schemaName, tableName, indexName): Op`
- `dropConstraint(schemaName, tableName, constraintName, constraintKind): Op`
- `createExtension(extensionName, ifNotExists: boolean): Op`
- `createSchema(schemaName, ifNotExists: boolean): Op`
- `createEnumType(schemaName, typeName, values: readonly string[]): Op`
- `addEnumValues(schemaName, typeName, values: readonly string[]): Op`
- `dropEnumType(schemaName, typeName): Op`
- `renameType(schemaName, oldName, newName): Op`
- `dataTransform(label, check: () => SqlQueryPlan, run: () => SqlQueryPlan, operationClass?: MigrationOperationClass): Op`

**Final list is the author's call.** The Spec §R3.1 ("Factories are exported from @prisma-next/target-postgres/migration; they produce `SqlMigrationPlanOperation`s from literal arguments only") is authoritative — this inventory is a reasonable starting point but the author adjusts as they go.

### `ColumnSpec` and related input shapes

`ColumnSpec` is the literal-args shape that `createTable` and `addColumn` accept. It's the fully-materialized column: name, expanded native type, normalized default, identity metadata, nullability. The shape is decided in this task (spec open question §1) and consumed by Phase 1's call classes as-is.

Rule of thumb: if a descriptor field requires a codec hook, a contract lookup, or access to `frameworkComponents` to materialize, it's the wrapper's job to compute it and the pure factory receives the materialized value. Pure factories must NEVER import `@prisma-next/framework-components`.

### One-to-many resolvers

Today's `resolveCreateDependency(descriptor, context)` returns an array of ops (`create extension` + `create schema` + `create enum type`). Phase 0 replaces this with:

- Three pure factories: `createExtension(...)`, `createSchema(...)`, `createEnumType(...)`.
- A thin wrapper `resolveCreateDependency(descriptor, context)` that dispatches to the appropriate pure factory based on `descriptor.kind` and returns a single op.
- If the descriptor shape truly represents "create all three for a single dependency", the wrapper returns an array of ops by making multiple pure factory calls. **Each pure factory call still returns one op.** "Pure factory returns exactly one operation" is an invariant for Phase 1.

Any other one-to-many resolver (verify by grepping `return [`) gets the same treatment.

### `dataTransform` during Phase 0

The pure `createDataTransform(label, check, run, operationClass?)` factory accepts `check` and `run` as plain closures (`() => SqlQueryPlan`) and otherwise looks like every other pure factory. The thin `resolveDataTransform(descriptor, context)` wrapper keeps the same semantics it has today: if the descriptor's `check` or `run` is the `TODO` sentinel, the wrapper constructs a user-equivalent closure (e.g. `() => placeholder(slot)` via the existing `placeholder()` helper in `@prisma-next/errors/migration`) and passes that to the pure factory. No new helpers are introduced in this phase; placeholder-as-AST-node is a Phase 1 concept and does not leak into Phase 0.

## Acceptance criteria

- [ ] Every `resolveX` in `operation-resolver.ts` is reduced to an argument-materialization + call to `createX`.
- [ ] No pure factory in `op-factories.ts` imports `@prisma-next/framework-components`, `@prisma-next/contract`, or references `OperationResolverContext`.
- [ ] Each pure factory returns exactly one `SqlMigrationPlanOperation`.
- [ ] `resolveDataTransform` preserves today's `TODO`-sentinel behavior: the existing descriptor-flow test that surfaces `PN-MIG-2001` still passes.
- [ ] No new helpers are added to `@prisma-next/errors/migration` — placeholder-as-AST-node work is Phase 1.
- [ ] `pnpm -r typecheck` and `pnpm -r lint` pass.
- [ ] All existing Postgres package tests pass unchanged.
- [ ] Integration test `schema-evolution-migrations.e2e.test.ts` passes unchanged.
- [ ] No functional-diff visible on `migration plan` output: for any fixture contract, the descriptor-flow operations emitted before and after the refactor are equivalent. Phase 0 is a pure source-level refactor, so operations *should* in fact be byte-identical; if they diverge, that's a bug to investigate before moving to Phase 1.
- [ ] Grep sweep: every `createX` in `op-factories.ts` has at least one call site in `operation-resolver.ts` (no orphaned factories).

## Non-goals

- No `OpFactoryCall` classes. Those arrive in Phase 1.
- No changes to `planner.ts` / `planner-reconciliation.ts`. Walk-schema is untouched.
- No changes to `migration-factories.ts` at the public API surface. (The *internal* implementation of the factories may be rewritten to delegate to `createX` from `op-factories.ts` if the author finds it cleaner, but the public signatures are frozen for Phase 0.)

## Open questions (resolved in this task)

1. **`ColumnSpec` field list.** Spec §"Open questions" §1 defers this to Phase 0 / Phase 1. Propose a shape during the early part of Phase 0 and land it with the first pure factory (`createTable`) that uses it. Record the chosen shape in `op-factories.ts` with a doc comment.

## Testing strategy

Phase 0 is behavior-preserving; new tests are minimal:

- Per-factory unit tests for `op-factories.ts` — one per factory, constructing a known input and asserting the returned op matches a hand-written expected op. These tests catch literal-arg preservation regressions in Phase 1.
- Existing tests are the behavior-preservation gate.

## Risks

- **`ColumnSpec` oversight.** Missing a field (e.g. `collation`) surfaces at Phase 1's call-class construction. Mitigation: cross-reference `ColumnDescriptor` type definitions and `resolveCreateTable`'s entire materialization block when drafting `ColumnSpec`.
- **Codec hook leakage.** A pure factory accidentally takes a codec hook because it's convenient. Mitigation: code review with explicit eyes on the `packages/` import block of `op-factories.ts`. If anything from `framework-components`, `codec`, or `contract` appears, it's a bug.

## Estimate

2 days. Half-day for the inventory + `ColumnSpec`; 1 day for the extraction; half-day for tests + review.

## References

- Plan: [`plan.md`](../plan.md) §"Phase 0"
- Spec: [`spec.md`](../spec.md) §R3.1, §R3.2
- `packages/3-targets/3-targets/postgres/src/core/migrations/operation-resolver.ts`
- `packages/1-framework/1-core/errors/src/migration.ts` (existing `placeholder` function + `errorUnfilledPlaceholder` — unchanged by this phase)
