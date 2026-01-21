# ADR 152 - Execution Plane Descriptors and Instances

**Status:** Implemented
**Date:** 2025-01-XX
**Authors:** Prisma Next Team
**Domain:** Core, Families, Targets, Adapters, Drivers, Extensions

## Context

The current execution/runtime plane stack (SQL family, Postgres target, adapters, drivers, extensions, runtime) evolved through several refactors:

- Runtime assembly uses ad-hoc shapes and factory functions without consistent type-level wiring
- Runtime entrypoints (`./runtime`) exist as placeholders but don't follow a consistent descriptor pattern
- Some runtime interfaces live in core (`RuntimeFamilyAdapter`), others in family packages, and some are only implicit
- Type-level compatibility between family/target/adapter/driver/extension at runtime is only partially enforced

As we add new targets (MySQL, MongoDB) and families (document), we need a clear, cross-family pattern for:

- Runtime descriptor identity and compatibility
- Runtime instance interfaces and lifecycle
- Control vs runtime plane entrypoints
- How runtime packs fit into the overall model

This ADR defines a consistent descriptor/instance pattern for the **execution/runtime plane**, mirroring ADR 151 for the control plane.

## Decision

We standardize on a **descriptor + instance** pattern for all execution/runtime-plane participants:

- **Descriptors** are flat data objects with identity and a factory method
- **Instances** are concrete objects implementing well-defined interfaces
- All descriptors and instances are parameterized by **family** and **target** IDs
- Descriptor and base instance interfaces live in **core** packages and are **cross-family**
- Families define **family-specific interfaces** that extend or refine the core base interfaces

We apply this pattern to:

- **Family**: RuntimeFamilyDescriptor / RuntimeFamilyInstance
- **Target**: RuntimeTargetDescriptor / RuntimeTargetInstance
- **Adapter**: RuntimeAdapterDescriptor / RuntimeAdapterInstance
- **Driver**: RuntimeDriverDescriptor / RuntimeDriverInstance
- **Extension**: RuntimeExtensionDescriptor / RuntimeExtensionInstance

This ADR does **not** change runtime behavior; it formalizes types, naming, and entrypoint structure so we can safely refactor existing runtime packs and add new ones.

### Canonical IDs

We treat the following identifiers as canonical, literal types:

- **Family IDs**: e.g. `type SqlFamilyId = 'sql'`
- **Target IDs**: e.g. `type PostgresTargetId = 'postgres'`

These IDs are:

- The values used in `contract.targetFamily` and `contract.target`
- Exposed on descriptors as `familyId` and `targetId`
- Reflected in instance interfaces for type-level wiring

### Cross-family descriptor interfaces

We introduce plane-first, cross-family descriptor interfaces in core, under:

- `@prisma-next/core-execution-plane` for execution/runtime-plane descriptors and base instances

Descriptors:

```ts
export interface RuntimeFamilyDescriptor<
  TFamilyId extends string,
  TFamilyInstance extends RuntimeFamilyInstance<TFamilyId> = RuntimeFamilyInstance<TFamilyId>,
> extends FamilyDescriptor<TFamilyId> {
  create<TTargetId extends string>(options: {
    readonly target: RuntimeTargetDescriptor<TFamilyId, TTargetId>;
    readonly adapter: RuntimeAdapterDescriptor<TFamilyId, TTargetId>;
    readonly driver: RuntimeDriverDescriptor<TFamilyId, TTargetId>;
    readonly extensions: readonly RuntimeExtensionDescriptor<TFamilyId, TTargetId>[];
  }): TFamilyInstance;
}

export interface RuntimeTargetDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TTargetInstance extends RuntimeTargetInstance<TFamilyId, TTargetId> = RuntimeTargetInstance<
    TFamilyId,
    TTargetId
  >,
> extends TargetDescriptor<TFamilyId, TTargetId> {
  create(): TTargetInstance;
}

export interface RuntimeAdapterDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterInstance extends RuntimeAdapterInstance<TFamilyId, TTargetId> = RuntimeAdapterInstance<
    TFamilyId,
    TTargetId
  >,
> extends TargetBoundComponentDescriptor<'adapter', TFamilyId, TTargetId> {
  create(): TAdapterInstance;
}

export interface RuntimeDriverDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TDriverInstance extends RuntimeDriverInstance<TTargetId> = RuntimeDriverInstance<TTargetId>,
> extends TargetBoundComponentDescriptor<'driver', TFamilyId, TTargetId> {
  create(options: unknown): Promise<TDriverInstance> | TDriverInstance;
}

export interface RuntimeExtensionDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TExtensionInstance extends RuntimeExtensionInstance<
    TFamilyId,
    TTargetId
  > = RuntimeExtensionInstance<TFamilyId, TTargetId>,
> extends TargetBoundComponentDescriptor<'extension', TFamilyId, TTargetId> {
  create(): TExtensionInstance;
}
```

Note: All runtime-plane descriptors extend base descriptor interfaces from `@prisma-next/contract/framework-components` which provide:
- `kind`: Discriminator literal
- `id`: Unique identifier
- `version`: Component version (semver)
- `targets?`: Target compatibility metadata
- `capabilities?`: Capability declarations
- `types?`: Type import specifications for contract.d.ts
- `operations?`: Operation manifests for building registries

Notes:

- Descriptors are **open for extension** via declaration merging or family-specific subtypes; families may add extra fields
- Adapters, drivers, and extensions are **strictly single-target** (`targetId` is a single literal, not an array)
- `kind` is a plane-level discriminator: `'family' | 'target' | 'adapter' | 'driver' | 'extension'`
- Driver `create()` accepts options (may be async or sync depending on driver implementation)

### Cross-family instance interfaces

We keep base instance interfaces in core to document the pattern and enable shared tooling. Families extend these base interfaces with richer, family-specific contracts.

Base instances:

```ts
export interface RuntimeFamilyInstance<TFamilyId extends string = string> {
  readonly familyId: TFamilyId;
}

export interface RuntimeTargetInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
  // Plane-specific hooks may be added here in future ADRs
}

export interface RuntimeAdapterInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
  // Family-specific runtime adapter interfaces extend this
}

export interface RuntimeDriverInstance<TTargetId extends string = string> {
  readonly targetId?: TTargetId;
}
```

**Note**: The base `RuntimeDriverInstance` interface only provides target identification. Family-specific driver interfaces (e.g., `SqlDriver` for SQL family) define the actual execution methods (`execute`, `explain`, `close`) that are specific to that family's execution model.

```typescript
// SQL family defines its own driver interface
export interface SqlDriver {
  connect(): Promise<void>;
  execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row>;
  explain?(request: SqlExecuteRequest): Promise<SqlExplainResult>;
  query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<SqlQueryResult<Row>>;
  close(): Promise<void>;
}

// Postgres driver combines both interfaces
export type PostgresRuntimeDriver = RuntimeDriverInstance<'postgres'> & SqlDriver;
```

```typescript
export interface RuntimeExtensionInstance<
  TFamilyId extends string = string,
  TTargetId extends string = string,
> {
  readonly familyId: TFamilyId;
  readonly targetId: TTargetId;
}
```

Family packages define richer interfaces like:

```ts
export interface SqlRuntimeAdapter<TTarget extends string = string>
  extends RuntimeAdapterInstance<'sql', TTarget> {
  lower(ast: QueryAst, context: LowererContext): LoweredStatement;
  // ... other SQL-specific adapter methods
}
```

### Entry points and exports

We standardize execution/runtime-plane entrypoints and default exports:

- Each pack exposes a **runtime-plane entrypoint**:
  - Family: `@prisma-next/family-sql/runtime`
  - Target: `@prisma-next/targets-postgres/runtime`
  - Adapter: `@prisma-next/targets-postgres-adapter/runtime`
  - Driver: `@prisma-next/targets-postgres-driver/runtime`
  - Extensions: `@prisma-next/extensions-*/runtime`
- Each runtime-plane entrypoint:
  - `export default` a flat descriptor object implementing the appropriate `Runtime*Descriptor` interface
  - May optionally export named types for family-specific interfaces (e.g. `SqlRuntimeAdapter`)

Descriptors:

- Are **frozen const objects** that implement the descriptor interface
- Encapsulate a **stateless factory function** `create(...)`
- Never hold mutable state; lifecycle is a caller concern:
  - Each `create(...)` call is permitted to create a fresh instance
  - Callers decide whether to cache instances

Instances:

- Are created via descriptor factories
- Implement the appropriate family-specific interfaces
- May be classes or plain objects; class vs object is an implementation detail

### Type-level compatibility

We enforce **compile-time compatibility** across the runtime-plane wiring:

- Families, targets, adapters, drivers, extensions are parameterized by `TFamilyId` and `TTargetId` literal types
- Runtime assembly uses these generics so mis-wiring is a type error:
  - A Postgres adapter cannot be wired to a Mongo target
  - A SQL extension for `targetId = 'postgres'` cannot be used with a MySQL target
- `familyId` and `targetId` fields are both:
  - Runtime values (used for logging, validation, and metadata)
  - Type-level anchors for TS inference and narrowing

### Scope for first phase (execution/runtime plane)

This ADR covers:

- Cross-family interfaces in core for the **execution/runtime plane**
- Refactoring and naming alignment for the **SQL family + Postgres target**:
  - **Core:** `Runtime*Descriptor`, `Runtime*Instance` in `@prisma-next/core-execution-plane`
  - **SQL family:** `SqlRuntimeAdapter`, SQL runtime family instance
  - **Postgres target pack:** Postgres runtime target descriptor and instance
  - **Postgres adapter pack:** Postgres runtime adapter descriptor and instance
  - **Postgres driver pack:** Postgres runtime driver descriptor and instance

Non-goals for this ADR:

- Document family and MongoDB target
- MySQL or other SQL targets
- Control-plane descriptors and instances (handled in ADR 151)

## Consequences

### Benefits

- **Consistency**: All runtime-plane participants follow the same descriptor + instance pattern
- **Type safety**: Mis-wiring family/target/adapter/driver/extension becomes a compile-time error
- **Clear separation**: Descriptors are pure data + factory; instances own state and behavior
- **Cross-family reuse**: Shared tooling (runtime factories, test harnesses) can rely on a small set of core interfaces
- **Future-proofing**: Adding new targets/families is a matter of implementing descriptors and instances, not inventing new shapes
- **Mirror control plane**: Runtime plane pattern mirrors control plane pattern, making the system easier to understand

### Risks and mitigations

- **Refactor surface area**: Touching core and multiple packs risks breakage
  - Mitigation: First phase is limited to runtime plane and the SQL + Postgres stack
  - Tests that exercise runtime execution, plan execution, and streaming provide guardrails
- **Control vs runtime drift**: Control and runtime planes might diverge over time
  - Mitigation: This ADR mirrors ADR 151's structure and conventions to minimize drift

## References

- [ADR 005 - Thin Core Fat Targets](./ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md)
- [ADR 011 - Unified Plan Model](./ADR%20011%20-%20Unified%20Plan%20model%20across%20lanes.md)
- [ADR 124 - Unified Async Iterable Execution Surface](./ADR%20124%20-%20Unified%20Async%20Iterable%20Execution%20Surface.md)
- [ADR 125 - Execution Mode Selection & Streaming Semantics](./ADR%20125%20-%20Execution%20Mode%20Selection%20&%20Streaming%20Semantics.md)
- [ADR 151 - Control Plane Descriptors and Instances](./ADR%20151%20-%20Control%20Plane%20Descriptors%20and%20Instances.md)

