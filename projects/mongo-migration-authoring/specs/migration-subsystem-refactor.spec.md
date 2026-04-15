# Summary

Move the Mongo migration subsystem (planner, runner, serializer, and supporting modules) from `@prisma-next/adapter-mongo` to `@prisma-next/target-mongo`, and refactor the runner to accept abstract visitor interfaces instead of depending directly on the `mongodb` driver. This corrects the layering: the planner, runner, and serializer are migration-plane concerns that belong in the target package, not the adapter.

# Description

The Mongo migration subsystem currently lives in `packages/3-mongo-target/2-mongo-adapter/src/core/`. Most of these modules have no dependency on the `mongodb` driver — they operate purely on AST types from `@prisma-next/mongo-query-ast` and schema IR from `@prisma-next/mongo-schema-ir`. They were placed in the adapter historically, but they belong in the target layer.

The one module that does touch `mongodb` is the runner (`mongo-runner.ts`), but only through two concrete executor classes (`MongoCommandExecutor`, `MongoInspectionExecutor`). These implement visitor interfaces (`MongoDdlCommandVisitor`, `MongoInspectionCommandVisitor`) already defined in the family layer (`@prisma-next/mongo-query-ast`). The runner itself only calls `command.accept(executor)` — it never uses `Db` directly for DDL execution. By accepting the visitor interfaces as injected dependencies, the runner can move to the target package while the concrete executor implementations stay in the adapter.

This follows the same adapter/driver pattern used for query execution: the orchestrator operates on abstract interfaces, and the adapter provides the concrete backing.

## Modules to move

From `packages/3-mongo-target/2-mongo-adapter/src/core/` to `packages/3-mongo-target/1-mongo-target/src/core/`:

| Module | Rationale |
|---|---|
| `mongo-planner.ts` | Pure diffing logic; depends on query-ast and schema-ir, not `mongodb` |
| `mongo-ops-serializer.ts` | Serialization/deserialization of AST; depends on query-ast and arktype, not `mongodb` |
| `contract-to-schema.ts` | Contract-to-schema-IR conversion; depends on mongo-contract and schema-ir, not `mongodb` |
| `ddl-formatter.ts` | Human-readable DDL formatting via visitor pattern; no `mongodb` dependency |
| `filter-evaluator.ts` | Pure filter evaluation logic; depends on query-ast filter types, not `mongodb` |

## Modules to refactor

| Module | Change |
|---|---|
| `mongo-runner.ts` | Refactor to accept `MongoDdlCommandVisitor<Promise<void>>` and `MongoInspectionCommandVisitor<Promise<Document[]>>` as injected dependencies instead of constructing them from `Db`. Moves to target. |

## Modules that stay in adapter

| Module | Rationale |
|---|---|
| `command-executor.ts` | Concrete `MongoDdlCommandVisitor` and `MongoInspectionCommandVisitor` implementations that use `mongodb` driver's `Db` type |
| `mongo-control-driver.ts` | Creates/manages `mongodb` connection, exposes `Db` |
| `introspect-schema.ts` | Directly queries `mongodb` to build schema IR from live database |

## Wiring changes

The `mongoTargetDescriptor` in `packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts` currently imports `MongoMigrationPlanner`, `MongoMigrationRunner`, and `contractToMongoSchemaIR` from `@prisma-next/adapter-mongo/control`. After the move, these imports come from `@prisma-next/target-mongo/control`.

The `createRunner` factory on the target descriptor will need to wire the concrete executor implementations from the adapter into the runner. This can be achieved by either:
- Having the family instance (passed to `createRunner`) provide the executors, or
- Passing the adapter's executor factory to the target descriptor at composition time

**Assumption:** The simplest approach is to have `createRunner` accept the family instance (which already has access to the driver) and construct the concrete executors there. The runner's `execute` method signature changes to accept executor instances rather than extracting `Db` internally.

# Requirements

## Functional Requirements

- All six modules listed above move from `adapter-mongo` to `target-mongo`, with their corresponding test files
- The runner's `execute` method accepts abstract visitor interfaces (`MongoDdlCommandVisitor<Promise<void>>` and `MongoInspectionCommandVisitor<Promise<Document[]>>`) rather than constructing them internally from a `Db` handle
- `@prisma-next/adapter-mongo/control` re-exports the moved symbols for backward compatibility during the transition (the adapter already re-exports `target-mongo/control` symbols like `initMarker`, `readMarker`, etc.)
- `@prisma-next/target-mongo/control` exports the planner, runner, serializer, contract-to-schema converter, DDL formatter, and filter evaluator
- The `mongoTargetDescriptor` in `9-family` imports planner, runner, and `contractToMongoSchemaIR` from `@prisma-next/target-mongo/control` instead of `@prisma-next/adapter-mongo/control`
- All existing tests pass without behavioral changes
- New dependencies added to `@prisma-next/target-mongo`: `@prisma-next/mongo-contract`, `@prisma-next/mongo-schema-ir`, `@prisma-next/utils`, `arktype`

## Non-Functional Requirements

- No behavioral changes — this is a pure structural refactoring
- Package layering validation (`pnpm lint:deps`) passes after the move
- The adapter's `mongodb` dependency does not leak into the target package

## Non-goals

- Refactoring the planner's internal logic (that's spec 2)
- Changing the `MigrationRunner` framework interface
- Moving `introspect-schema.ts` to the target (it genuinely needs the driver)
- Removing the backward-compat re-exports from `adapter-mongo/control` in this change

# Acceptance Criteria

## Module relocation

- [ ] `mongo-planner.ts`, `mongo-ops-serializer.ts`, `contract-to-schema.ts`, `ddl-formatter.ts`, `filter-evaluator.ts` live in `packages/3-mongo-target/1-mongo-target/src/core/`
- [ ] `mongo-runner.ts` lives in `packages/3-mongo-target/1-mongo-target/src/core/`
- [ ] Their test files move to `packages/3-mongo-target/1-mongo-target/test/`
- [ ] `@prisma-next/target-mongo/control` exports all moved symbols

## Runner abstraction

- [ ] `MongoMigrationRunner.execute()` accepts `MongoDdlCommandVisitor<Promise<void>>` and `MongoInspectionCommandVisitor<Promise<Document[]>>` as parameters (or via constructor injection)
- [ ] The runner has no `import ... from 'mongodb'` statement
- [ ] `MongoCommandExecutor` and `MongoInspectionExecutor` remain in `adapter-mongo` and are wired into the runner at composition time

## Backward compatibility

- [ ] `@prisma-next/adapter-mongo/control` re-exports all moved symbols so existing consumers are not broken
- [ ] `mongoTargetDescriptor` in `9-family` imports from `@prisma-next/target-mongo/control`

## Validation

- [ ] All existing tests pass (`pnpm test:packages`)
- [ ] Package layering passes (`pnpm lint:deps`)
- [ ] `@prisma-next/target-mongo` does not depend on `mongodb` for the moved modules (the existing marker-ledger dependency is acceptable)
- [ ] E2E and integration tests pass (`pnpm test:e2e`, `pnpm test:integration`)

# Other Considerations

## Security

Not applicable — pure internal refactoring, no new public API surface.

## Cost

No runtime cost impact. Build/CI times unchanged.

## Observability

Not applicable.

## Data Protection

Not applicable.

## Analytics

Not applicable.

# References

- Current planner: [`packages/3-mongo-target/2-mongo-adapter/src/core/mongo-planner.ts`](packages/3-mongo-target/2-mongo-adapter/src/core/mongo-planner.ts)
- Current runner: [`packages/3-mongo-target/2-mongo-adapter/src/core/mongo-runner.ts`](packages/3-mongo-target/2-mongo-adapter/src/core/mongo-runner.ts)
- Current serializer: [`packages/3-mongo-target/2-mongo-adapter/src/core/mongo-ops-serializer.ts`](packages/3-mongo-target/2-mongo-adapter/src/core/mongo-ops-serializer.ts)
- Visitor interfaces (family layer): [`packages/2-mongo-family/4-query/query-ast/src/ddl-visitors.ts`](packages/2-mongo-family/4-query/query-ast/src/ddl-visitors.ts)
- Concrete executors (stay in adapter): [`packages/3-mongo-target/2-mongo-adapter/src/core/command-executor.ts`](packages/3-mongo-target/2-mongo-adapter/src/core/command-executor.ts)
- Target descriptor (consumer): [`packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts`](packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts)
- Framework `MigrationRunner` interface: [`packages/1-framework/1-core/framework-components/src/control-migration-types.ts`](packages/1-framework/1-core/framework-components/src/control-migration-types.ts)
- Parent project spec: [`projects/mongo-migration-authoring/spec.md`](../spec.md)

# Open Questions

1. **Runner dependency injection style**: Should the runner accept executors via constructor injection (set once, reused across `execute` calls) or as parameters to each `execute` call? Constructor injection is simpler if the runner is created once per session; parameter injection is more flexible. **Default assumption:** Constructor injection, since `createRunner` already creates a fresh instance per session.

2. **`target-mongo` already depends on `mongodb`** (for marker-ledger operations which use `Db`). Should the marker-ledger also be refactored to accept an abstract interface, or is that a separate concern? **Default assumption:** Out of scope; the marker operations are small and isolated, and refactoring them can happen independently.
