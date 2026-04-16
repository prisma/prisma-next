# Summary

Move the Mongo migration subsystem (planner, runner, serializer, and supporting modules) from `@prisma-next/adapter-mongo` to `@prisma-next/target-mongo`, and refactor the runner to accept abstract visitor interfaces instead of depending directly on the `mongodb` driver. This corrects the layering: the planner, runner, and serializer are migration-plane concerns that belong in the target package, not the adapter.

# Description

The Mongo migration subsystem currently lives in `packages/3-mongo-target/2-mongo-adapter/src/core/`. Most of these modules have no dependency on the `mongodb` driver — they operate purely on AST types from `@prisma-next/mongo-query-ast` and schema IR from `@prisma-next/mongo-schema-ir`. They were placed in the adapter historically, but they belong in the target layer.

The one module that does touch `mongodb` is the runner (`mongo-runner.ts`), through two mechanisms:

1. **DDL execution** — two concrete executor classes (`MongoCommandExecutor`, `MongoInspectionExecutor`) that implement visitor interfaces (`MongoDdlCommandVisitor`, `MongoInspectionCommandVisitor`) already defined in the family layer (`@prisma-next/mongo-query-ast`). The runner itself only calls `command.accept(executor)` — it never uses `Db` directly for DDL execution.

2. **Marker operations** — four marker-ledger functions (`readMarker`, `initMarker`, `updateMarker`, `writeLedgerEntry`) that take `Db` directly. These functions already construct command AST objects (`RawAggregateCommand`, `RawInsertOneCommand`, `RawFindOneAndUpdateCommand` from `mongo-query-ast/execution`) internally, but execute them inline against `Db` rather than dispatching through a visitor.

Both dependencies can be abstracted: DDL executors via the existing visitor interfaces (injected at construction), and marker operations via an injected `MarkerOperations` interface. With both abstractions in place, the runner has no dependency on the `mongodb` driver — concrete implementations stay in the adapter, and the runner operates purely on abstract interfaces.

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
| `mongo-runner.ts` | Refactor to accept `MongoDdlCommandVisitor<Promise<void>>` and `MongoInspectionCommandVisitor<Promise<Document[]>>` as injected dependencies instead of constructing them from `Db`. Accept marker operations via an injected `MarkerOperations` interface instead of calling marker-ledger functions directly with `Db`. Moves to target. |
| `marker-ledger.ts` | Extract a `MarkerOperations` interface that the runner depends on. The existing functions become the concrete implementation (they already construct command ASTs internally). The interface lives in the target; the concrete implementation can stay in the target too (it already lives there), but the runner depends only on the interface, not on `Db`. |

## Modules that stay in adapter

| Module | Rationale |
|---|---|
| `command-executor.ts` | Concrete `MongoDdlCommandVisitor` and `MongoInspectionCommandVisitor` implementations that use `mongodb` driver's `Db` type |
| `mongo-control-driver.ts` | Creates/manages `mongodb` connection, exposes `Db` |
| `introspect-schema.ts` | Directly queries `mongodb` to build schema IR from live database |

## Wiring changes

The `mongoTargetDescriptor` in `packages/2-mongo-family/9-family/src/core/mongo-target-descriptor.ts` currently imports `MongoMigrationPlanner`, `MongoMigrationRunner`, and `contractToMongoSchemaIR` from `@prisma-next/adapter-mongo/control`. After the move, these imports come from `@prisma-next/target-mongo/control`.

The `createRunner` factory on the target descriptor will need to wire:
1. The concrete DDL/inspection executor implementations from the adapter into the runner
2. A concrete `MarkerOperations` implementation (backed by `Db`) into the runner

Both are injected via constructor. The `createRunner` factory in `mongoTargetDescriptor` is the composition site — it has access to the adapter's executors and to the driver's `Db` handle (via the family instance). The runner itself never sees `Db`.

# Requirements

## Functional Requirements

- All six modules listed above move from `adapter-mongo` to `target-mongo`, with their corresponding test files
- The runner's constructor accepts abstract visitor interfaces (`MongoDdlCommandVisitor<Promise<void>>` and `MongoInspectionCommandVisitor<Promise<Document[]>>`) and a `MarkerOperations` interface, rather than depending on `Db` or constructing executors internally
- A `MarkerOperations` interface in the target package abstracts the four marker-ledger operations (`readMarker`, `initMarker`, `updateMarker`, `writeLedgerEntry`). The runner depends on this interface, not on `Db`.
- All consumers that previously imported moved symbols from `@prisma-next/adapter-mongo/control` are updated to import from `@prisma-next/target-mongo/control` directly
- `@prisma-next/adapter-mongo/control` does not re-export any symbols from `@prisma-next/target-mongo/control`
- `@prisma-next/target-mongo/control` exports the planner, runner, serializer, contract-to-schema converter, DDL formatter, and filter evaluator
- The `mongoTargetDescriptor` in `9-family` imports planner, runner, and `contractToMongoSchemaIR` from `@prisma-next/target-mongo/control` instead of `@prisma-next/adapter-mongo/control`
- All existing tests pass without behavioral changes
- New dependencies added to `@prisma-next/target-mongo`: `@prisma-next/mongo-contract`, `@prisma-next/mongo-schema-ir`, `@prisma-next/utils`, `arktype`

## Non-Functional Requirements

- No behavioral changes — this is a pure structural refactoring
- Package layering validation (`pnpm lint:deps`) passes after the move
- The runner module (`mongo-runner.ts`) has no dependency on `mongodb` types — neither direct imports nor transitive type re-exports. The `Db` type does not appear in the runner's interface or implementation.
- The marker-ledger module may still depend on `mongodb` internally (it lives in the target and the concrete implementation needs `Db`), but the runner interacts with it only through the `MarkerOperations` interface

## Non-goals

- Refactoring the planner's internal logic (that's spec 2)
- Changing the `MigrationRunner` framework interface
- Moving `introspect-schema.ts` to the target (it genuinely needs the driver)
- Adding backward-compat re-exports to `adapter-mongo/control` — consumers must be updated to import from the correct package
- Refactoring the marker-ledger's internal implementation (it can keep using `Db` directly; only the runner's dependency on it needs to go through an interface)

# Acceptance Criteria

## Module relocation

- [ ] `mongo-planner.ts`, `mongo-ops-serializer.ts`, `contract-to-schema.ts`, `ddl-formatter.ts`, `filter-evaluator.ts` live in `packages/3-mongo-target/1-mongo-target/src/core/`
- [ ] `mongo-runner.ts` lives in `packages/3-mongo-target/1-mongo-target/src/core/`
- [ ] Their test files move to `packages/3-mongo-target/1-mongo-target/test/`
- [ ] `@prisma-next/target-mongo/control` exports all moved symbols

## Runner abstraction

- [ ] `MongoMigrationRunner` constructor accepts `MongoDdlCommandVisitor<Promise<void>>`, `MongoInspectionCommandVisitor<Promise<Document[]>>`, and `MarkerOperations` — no `Db` in the runner's interface
- [ ] The runner has no `import ... from 'mongodb'` statement and no transitive dependency on the `Db` type (no imports from `marker-ledger` that re-export `Db`)
- [ ] `MongoCommandExecutor` and `MongoInspectionExecutor` remain in `adapter-mongo` and are wired into the runner at composition time
- [ ] A `MarkerOperations` interface exists in the target package with methods for `readMarker`, `initMarker`, `updateMarker`, `writeLedgerEntry`
- [ ] The concrete `MarkerOperations` implementation (backed by `Db`) is constructed at the composition site (`mongoTargetDescriptor.createRunner`) and injected into the runner

## Import migration

- [ ] All consumers that previously imported moved symbols from `@prisma-next/adapter-mongo/control` are updated to import from `@prisma-next/target-mongo/control`
- [ ] `@prisma-next/adapter-mongo/control` does not re-export any symbols from `@prisma-next/target-mongo/control`
- [ ] `mongoTargetDescriptor` in `9-family` imports from `@prisma-next/target-mongo/control`

## Validation

- [ ] All existing tests pass (`pnpm test:packages`)
- [ ] Package layering passes (`pnpm lint:deps`)
- [ ] The runner module does not depend on `mongodb` types — the `Db` type does not appear in its imports, interface, or implementation
- [ ] `marker-ledger.ts` does not `export type { Db }` (the type stays internal to the marker-ledger module; the runner never sees it)
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

2. ~~**`target-mongo` already depends on `mongodb`** (for marker-ledger operations which use `Db`). Should the marker-ledger also be refactored to accept an abstract interface, or is that a separate concern? **Default assumption:** Out of scope.~~ **Resolved:** In scope. The marker-ledger dependency on `Db` is the root cause of the runner's remaining `mongodb` coupling. A `MarkerOperations` interface abstracts it cleanly — the runner depends on the interface, the concrete implementation (which uses `Db`) is injected at the composition site. Without this, the runner cannot be fully decoupled and the `Db` type leaks into the target package's public API via `export type { Db }`.
