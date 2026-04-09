# ADR 191 — Generic three-phase migration operation envelope and family-provided serialization

**Status:** Accepted, not yet implemented.

## At a glance

Both SQL and Mongo migration families independently implement the same three-phase operation structure: prechecks, execute steps, and postchecks. The framework should own the envelope shape; families should only provide the content types and a serializer. This eliminates the duplication and gives future families a clear contract for migration operations.

## Context

The framework's `MigrationPlanOperation` today carries only display fields:

```ts
interface MigrationPlanOperation {
  readonly id: string;
  readonly label: string;
  readonly operationClass: MigrationOperationClass;
}
```

Both families extend this with the same three-phase structure, independently:

**SQL** (in `@prisma-next/sql-family`):

```ts
interface SqlMigrationPlanOperation<TTargetDetails> extends MigrationPlanOperation {
  readonly precheck: readonly SqlMigrationPlanOperationStep[];
  readonly execute: readonly SqlMigrationPlanOperationStep[];
  readonly postcheck: readonly SqlMigrationPlanOperationStep[];
}
// where SqlMigrationPlanOperationStep = { description: string; sql: string; meta?: ... }
```

**Mongo** (in `@prisma-next/mongo-query-ast/control`):

```ts
interface MongoMigrationPlanOperation extends MigrationPlanOperation {
  readonly precheck: readonly MongoMigrationCheck[];
  readonly execute: readonly MongoMigrationStep[];
  readonly postcheck: readonly MongoMigrationCheck[];
}
// where MongoMigrationStep = { description: string; command: AnyMongoDdlCommand }
// and MongoMigrationCheck = { description: string; source: ...; filter: ...; expect: ... }
```

The parallel is exact: same array names, same three-phase semantics, same relationship to the framework base type. Each family also has a parallel serializer (`serializeMongoOps` / the SQL plan serializer) and the CLI has a `switch(familyId)` for operation display formatting.

## Decision

Extract the three-phase structure into the framework as a generic:

```ts
interface MigrationPlanOperation<TStep, TCheck> {
  readonly id: string;
  readonly label: string;
  readonly operationClass: MigrationOperationClass;
  readonly precheck: readonly TCheck[];
  readonly execute: readonly TStep[];
  readonly postcheck: readonly TCheck[];
}
```

SQL instantiates this as `MigrationPlanOperation<SqlStep, SqlCheck>`. Mongo instantiates it as `MigrationPlanOperation<MongoMigrationStep, MongoMigrationCheck>`.

### Serialization SPI

Each family provides a serializer for its step and check types:

```ts
interface MigrationOperationSerializer<TStep, TCheck> {
  serializeStep(step: TStep): Record<string, unknown>;
  serializeCheck(check: TCheck): Record<string, unknown>;
  deserializeStep(json: Record<string, unknown>): TStep;
  deserializeCheck(json: Record<string, unknown>): TCheck;
}
```

The framework handles the envelope (`id`, `label`, `operationClass`, array structure), delegating the content of each step/check to the family-provided serializer. This replaces the current pattern where each family serializes the entire operation independently.

### CLI display

The `switch(familyId)` in the CLI's `extractOperationStatements` is replaced by a method on `TargetMigrationsCapability`:

```ts
interface TargetMigrationsCapability<...> {
  // ... existing methods ...
  formatOperationStatements?(operations: readonly MigrationPlanOperation[]): string[];
}
```

The CLI calls `targetDescriptor.migrations.formatOperationStatements(ops)` when available. Each family provides a formatter that knows how to render its step types as display strings.

## What changes

- `MigrationPlanOperation` in `@prisma-next/framework-components` becomes generic over `TStep` and `TCheck`.
- A `MigrationOperationSerializer` SPI is added to `@prisma-next/framework-components`.
- `TargetMigrationsCapability` gains an optional `formatOperationStatements` method.
- SQL and Mongo families conform to the generic, removing their independent envelope definitions.
- The CLI `switch(familyId)` dispatch is replaced by the capability method.

## What doesn't change

- The runner loop (precheck → execute → postcheck) — same semantics, same three-phase flow.
- The `ops.json` plan file format — same JSON structure, same fields.
- The rehydration model described in [ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md) — the deserializer still reconstructs live AST objects from `kind` discriminants.
- The composability property — users and extension packs can still assemble operations from primitives.

This is a type-level refactor that eliminates duplication, not a behavioral change.

## Current state

The Mongo M1 implementation is designed for this extraction — `MongoMigrationPlanOperation` already mirrors the target generic shape. The SQL family's `SqlMigrationPlanOperation` has the same structure with a `TTargetDetails` parameter for target-specific metadata. The extraction requires aligning both to the framework generic and wiring the serialization SPI.
