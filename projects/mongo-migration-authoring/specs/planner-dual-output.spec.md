# Summary

Refactor the `MongoMigrationPlanner` to produce an intermediate `OpFactoryCall[]` representation instead of constructing `MongoMigrationPlanOperation[]` directly. Add two renderers: one that materializes `OpFactoryCall[]` into `MongoMigrationPlanOperation[]` (preserving current behavior), and one that renders `OpFactoryCall[]` into TypeScript migration files that call the existing factory functions.

# Description

Today the `MongoMigrationPlanner` has inline `planCreateIndex`, `planDropIndex`, `planCreateCollection`, `planDropCollection`, `planValidatorDiff`, and `planMutableOptionsDiff` helper functions that directly construct `MongoMigrationPlanOperation` objects with AST command classes, filter expressions, and check structures. The same logic is duplicated in the hand-authored migration factory functions (`createIndex`, `dropIndex`, `createCollection`, `dropCollection`, `collMod`).

The goal is to make the planner produce a higher-level representation — an array of `OpFactoryCall` objects — that describes *which factory to call with which arguments*, rather than the fully-expanded operation. Two renderers then interpret this representation:

1. **Operation renderer** (`renderOps`): Calls the factory functions to produce `MongoMigrationPlanOperation[]`. This is the existing behavior, preserved for `db init`, `db update`, and any other path that needs raw operations.

2. **TypeScript renderer** (`renderTypeScript`): Generates a complete TypeScript migration file (`migration.ts`) that imports the factory functions and calls them in `plan()`. This enables `prisma migration plan` to produce editable migration files that users can modify before applying.

## `OpFactoryCall` type

A discriminated union of frozen AST classes following the codebase's established class/visitor pattern (see `MongoAstNode`). Each concrete class extends an abstract `OpFactoryCallNode` base, carries a `factory` discriminant as a literal type, and implements `accept(visitor)` for exhaustive dispatch:

```typescript
abstract class OpFactoryCallNode {
  abstract readonly factory: string;
  abstract accept<R>(visitor: OpFactoryCallVisitor<R>): R;
}

class CreateIndexCall extends OpFactoryCallNode { readonly factory = 'createIndex' as const; /* ... */ }
class DropIndexCall extends OpFactoryCallNode { readonly factory = 'dropIndex' as const; /* ... */ }
class CreateCollectionCall extends OpFactoryCallNode { readonly factory = 'createCollection' as const; /* ... */ }
class DropCollectionCall extends OpFactoryCallNode { readonly factory = 'dropCollection' as const; /* ... */ }
class CollModCall extends OpFactoryCallNode { readonly factory = 'collMod' as const; /* ... */ }

type OpFactoryCall = CreateIndexCall | DropIndexCall | CreateCollectionCall | DropCollectionCall | CollModCall;
```

Each class captures exactly the arguments of the corresponding factory function. Instances are frozen at construction time to ensure immutability. The `OpFactoryCallVisitor<R>` interface provides compile-time exhaustiveness: adding a new variant forces all visitor implementations to handle it.

## Factory alignment

The existing planner helper functions and the hand-authored factory functions have slightly different signatures and behaviors in some cases (e.g., the planner's `planCreateCollection` maps `MongoSchemaCollectionOptions` to `CreateCollectionOptions`, while the factory takes `CreateCollectionOptions` directly). As part of this work, the factory signatures are aligned so the planner can produce `OpFactoryCall` values that map 1:1 to factory calls. Since the factories were just created for the migration authoring project, their signatures can be adjusted freely.

The planner's `planValidatorDiff` function currently produces `collMod` operations directly. After alignment, this maps to `OpFactoryCall` with `factory: 'collMod'`, and its `operationClass` (`widening` vs `destructive`) is determined by `classifyValidatorUpdate` inside the planner — where the origin-validator context needed for that classification is available — and carried on the call IR (see shipped behaviour below).

**Decision (shipped, supersedes earlier assumption):** `operationClass` (and the human-readable `label`) live on every `OpFactoryCall` instance rather than being re-derived in `renderOps`. The planner is the only site with the origin-validator context required to classify a `collMod` update correctly, so classification happens there and the result rides along with the call. See Decisions §2 and Open Questions §1 below for rationale.

## Conflict detection stays in the planner

The planner's conflict detection logic (immutable option changes, policy violations) operates on the schema diff, not on the generated operations. This stays in the planner and runs before `OpFactoryCall[]` generation.

# Requirements

## Functional Requirements

- `OpFactoryCall` discriminated union type defined in `@prisma-next/target-mongo/control`, covering all five factory functions
- `MongoMigrationPlanner.plan()` internally produces `OpFactoryCall[]` and passes it through the operation renderer to return `MigrationPlannerResult` (preserving the existing interface)
- A new `MongoMigrationPlanner.planCalls()` method (or similar) returns the raw `OpFactoryCall[]` for consumers that need the intermediate representation
- An operation renderer function (`renderOps(calls: OpFactoryCall[]): MongoMigrationPlanOperation[]`) that calls the factory functions to produce operations
- A TypeScript renderer function (`renderTypeScript(calls: OpFactoryCall[], meta?: MigrationMeta): string`) that produces a complete, runnable migration file
- Factory function signatures in `migration-factories.ts` are aligned with `OpFactoryCall` argument shapes so the mapping is 1:1
- The planner assigns `operationClass` (and `label`) to each `OpFactoryCall` instance as part of construction (using `classifyValidatorUpdate` for `collMod`, constant literals for the additive/destructive variants); `renderOps` reads `call.operationClass` without re-deriving. See Decisions §2.
- The TypeScript renderer generates valid TypeScript that imports from `@prisma-next/target-mongo/migration` and calls the factory functions

## Non-Functional Requirements

- The `plan()` method's external behavior is unchanged — consumers (CLI, target descriptor, tests) see the same `MigrationPlannerResult`
- The TypeScript renderer produces readable, idiomatic code (proper formatting, minimal boilerplate)
- `OpFactoryCall` uses frozen AST classes with a visitor interface, consistent with the codebase's `MongoAstNode` pattern, providing compile-time exhaustiveness for all dispatch sites

## Non-goals

- CLI integration for `prisma migration plan --emit-ts` (future work — the renderer is the building block)
- Automatic migration file scaffolding from the CLI
- Supporting SQL targets with this specific `OpFactoryCall` type (each target will have its own factory call type)
- Data transform operations in the generated TypeScript

# Acceptance Criteria

## OpFactoryCall type

- [ ] `OpFactoryCall` is a discriminated union with variants for `createIndex`, `dropIndex`, `createCollection`, `dropCollection`, `collMod`
- [ ] Each variant's fields match the aligned factory function's parameters exactly
- [ ] The type is exported from `@prisma-next/target-mongo/control`

## Planner refactoring

- [ ] `MongoMigrationPlanner` internally produces `OpFactoryCall[]` from the schema diff
- [ ] `plan()` returns the same `MigrationPlannerResult` as before (behavioral equivalence verified by existing tests)
- [ ] A method or function exposes the raw `OpFactoryCall[]` for downstream consumers
- [ ] Conflict detection (immutable options, policy violations) is preserved

## Operation renderer

- [ ] `renderOps(calls)` produces `MongoMigrationPlanOperation[]` identical to the current planner output for the same inputs
- [ ] Round-trip equivalence: for any schema diff, `renderOps(planner.planCalls(...))` produces the same operations as the current `planner.plan(...)` (verified by test comparing JSON output)
- [ ] `operationClass` on each `OpFactoryCall` correctly reflects the planner's classification (constant per variant for additive/destructive factories; set via `CollModMeta` for `CollModCall`, using `classifyValidatorUpdate`)

## TypeScript renderer

- [ ] `renderTypeScript(calls)` produces a syntactically valid TypeScript file
- [ ] The generated file imports from `@prisma-next/target-mongo/migration`
- [ ] The generated file can be executed with `tsx` to produce `ops.json`
- [ ] The generated `ops.json` is identical to what `renderOps(calls)` produces when serialized (round-trip equivalence)
- [ ] When `meta` is provided, the generated file includes a `describe()` method returning the metadata

## Factory alignment

- [ ] Factory function signatures in `migration-factories.ts` align with `OpFactoryCall` argument shapes
- [ ] The planner's `planCreateCollection` mapping from `MongoSchemaCollectionOptions` to `CreateCollectionOptions` is extracted to a reusable helper

# Other Considerations

## Security

Not applicable — no new external API surface; the TypeScript renderer produces source code that is written to disk by the CLI.

## Cost

No runtime cost impact. The intermediate representation adds negligible overhead (one extra array allocation per plan).

## Observability

Not applicable.

## Data Protection

Not applicable.

## Analytics

Not applicable.

# References

- Current planner: [`packages/3-mongo-target/2-mongo-adapter/src/core/mongo-planner.ts`](packages/3-mongo-target/2-mongo-adapter/src/core/mongo-planner.ts) (will move to `target-mongo` per spec 1)
- Factory functions: [`packages/3-mongo-target/1-mongo-target/src/core/migration-factories.ts`](packages/3-mongo-target/1-mongo-target/src/core/migration-factories.ts)
- `Migration` base class: [`packages/1-framework/3-tooling/migration/src/migration-base.ts`](packages/1-framework/3-tooling/migration/src/migration-base.ts)
- Migration authoring spec (parent): [`projects/mongo-migration-authoring/spec.md`](../spec.md)
- Migration subsystem refactor spec (prerequisite): [`projects/mongo-migration-authoring/specs/migration-subsystem-refactor.spec.md`](migration-subsystem-refactor.spec.md)

# Decisions

1. **`OpFactoryCall` uses frozen AST classes with a visitor interface.** This matches the codebase's established `MongoAstNode` pattern and provides compile-time exhaustiveness: adding a new variant forces all dispatch sites (renderers, planner helpers) to handle it. The trade-off versus plain data is that tests must import and construct class instances, and serialized values lose their visitor capability — but exhaustiveness is more valuable here since dispatch sites are spread across multiple modules (`renderOps`, `renderTypeScript`, planner label/operationClass derivation).

2. **`operationClass` (and `label`) live on `OpFactoryCall`.** An earlier draft of this spec had them derived in `renderOps`; the shipped design stores them on every call instance instead. The planner is the only site with the context required to classify a `collMod`'s validator update as `widening` vs `destructive` — that decision runs `classifyValidatorUpdate` over the origin validator, which `renderOps` does not see. Deriving in the renderer would mean either threading origin-validator state through the scaffolding/emit pipeline to a node that otherwise only needs the call arguments, or duplicating `classifyValidatorUpdate` and its inputs on both sides. Storing `operationClass` on the call keeps each call self-describing (planner-produced semantics travel with it), keeps `renderOps` purely structural, and matches how `label` is handled. The trade-off is that the IR is no longer purely syntactic — it carries planner-derived semantics — and an "inverse" path that built calls from user-authored factory invocations would have to re-derive them somehow. That inverse path is not in scope for this spec; the additive/destructive variants (`CreateIndexCall`, `DropCollectionCall`, etc.) have constant `operationClass`es baked into the class literals, and only `CollModCall` carries a computed one via its `meta` parameter.

3. **Prerequisite: migration subsystem refactor.** This spec assumes the planner and factories are co-located in `@prisma-next/target-mongo` (per the migration-subsystem-refactor spec). The planner needs to import and call the factory functions, which requires them to be in the same package or a dependency.

# Open Questions

1. **How should `operationClass` be derived for `collMod` calls?** *(Resolved — shipped design.)* The planner classifies validator updates as `widening` or `destructive` via `classifyValidatorUpdate`, which compares the origin and destination validators. Since only the planner has the origin-validator context, the classification is performed there and stored on the call: `CollModCall` accepts a `meta: CollModMeta` argument carrying an optional `operationClass` (and `label`) which the planner sets, defaulting to `'destructive'` when the planner has insufficient context. All other `OpFactoryCall` variants have a constant `operationClass` baked into the class literal (`'additive'` for create-calls, `'destructive'` for drop-calls). `renderOps` simply reads `call.operationClass` — it never re-derives. See Decisions §2 for the rationale.

2. **Should `renderTypeScript` produce the `Migration.run(import.meta)` line?** The hand-authored migration pattern includes this line at the bottom. The rendered file should include it so it's immediately runnable. **Default assumption:** Yes, include it.

3. **Should `planCalls()` be a separate method on the planner, or should `plan()` return a richer result that includes both `OpFactoryCall[]` and the rendered operations?** **Default assumption:** A separate `planCalls()` method that returns `{ kind: 'success'; calls: OpFactoryCall[] } | { kind: 'failure'; conflicts: ... }`, sharing the same conflict-detection logic as `plan()`.
