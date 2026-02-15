# Runtime DX: Decouple Runtime Driver Instantiation from Connection Binding

Date: 2026-02-15  
Status: Draft  
Linear: [TML-1837](https://linear.app/prisma-company/issue/TML-1837/runtime-dx-decouple-runtime-driver-instantiation-from-connection)

## Summary

Separate **driver instantiation** from **connection binding** so that runtime drivers can be instantiated without connection configuration. Connection information is provided only at connect time, enabling stack instantiation to be fully deterministic and environment-free.

This aligns execution-plane drivers with target/adapter/extension behavior: `instantiateExecutionStack()` produces a complete stack (including driver) without requiring env access. Connection/pool/client wiring happens at the boundary where env/runtime configuration is available.

## Terminology (Recorded for Spec and ADR)

See [ADR 159 — Driver Terminology and Lifecycle](../../../docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md).

- **Driver**: In Prisma Next, "driver" refers to the Prisma Next interface implementing execution behavior—*not* the underlying library (e.g. `pg`). All drivers adhere to a common interface. Instantiation ≠ connection.
- **Connection binding**: Driver-determined configuration that wires the driver to a transport (e.g. Postgres: pool/client; future: HTTP, in-memory).

## Context

Today, runtime drivers require connection configuration at driver instantiation time. `RuntimeDriverDescriptor.create(options)` expects `PostgresDriverOptions` with `connect: { pool | client }`, making it environment-bound. As a result:

- `instantiateExecutionStack()` cannot instantiate the driver; the driver is created later in `postgres()`'s `runtime()` getter.
- `ExecutionStackInstance` does not include a driver field; the stack is incomplete at instantiation.
- The driver is passed separately into `createRuntime()`, diverging from target/adapter/extension patterns.

This spec proposes a lifecycle where the driver is instantiated like other stack components (no connection args), and connection binding happens at connect time.

## Goals

- Runtime drivers are instantiable without connection info (`create()` returns unbound driver).
- Connection binding is driver-determined; each driver defines its own binding type.
- `ExecutionStackInstance` includes a `driver` field; stack instantiation is complete and deterministic.
- Shared interfaces avoid Postgres-specific binding types.
- Runtime manages connection semantics with a deterministic default: use-before-connect fails fast with a clear error.
- Document driver terminology and lifecycle in spec and/or ADR.

## Non-goals

- Changing adapter/target descriptor patterns.
- Introducing new targets/drivers beyond Postgres (unless needed for shared typing).
- Control-plane driver changes (leave unchanged).
- MySQL/SQLite or other future drivers.
- Public API changes to `postgres()` beyond connection binding flow.
- Transaction or connection pooling behavior changes.

## Scope / Non-scope Summary

| In scope | Out of scope |
|----------|--------------|
| Runtime driver connection binding model (types + lifecycle) | Adapter/target descriptor patterns |
| `@prisma-next/sql-relational-core` driver interface updates | New targets/drivers beyond Postgres |
| Postgres runtime driver: create unbound, bind at connect | Control-plane driver |
| `instantiateExecutionStack()` includes driver in instance | MySQL/SQLite |
| `ExecutionStackInstance` gains `driver` field | `postgres()` API surface changes (beyond wiring) |
| Examples and tests | Transaction/pooling behavior |

## Proposed API and Lifecycle

### 1. RuntimeDriverDescriptor.create()

**Current:** `create(options: unknown): TDriverInstance` — Postgres passes `{ connect, cursor }`.

**Proposed:** `create(options?: TCreateOptions): TDriverInstance` — no connection required. Driver-specific options (e.g. `cursor` for Postgres) may be passed; connection is never part of `create()`.

```ts
// @prisma-next/core-execution-plane/types
export interface RuntimeDriverDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TCreateOptions = void,
  TDriverInstance extends RuntimeDriverInstance<TFamilyId, TTargetId> = RuntimeDriverInstance<
    TFamilyId,
    TTargetId
  >,
> extends DriverDescriptor<TFamilyId, TTargetId> {
  create(options?: TCreateOptions): TDriverInstance; // optional; no connection
}
```

### 2. SqlDriver.connect()

**Current:** `connect(): Promise<void>` — no-op for Postgres (caller controls pool/client).

**Proposed:** `connect(binding: TBinding): Promise<void>` — accepts driver-determined binding via a type parameter. The shared interface does not encode Postgres (pool/client). Each driver provides its own binding type (Postgres, HTTP transport, in-memory, etc.) while preserving compile-time type safety at driver call sites.

```ts
// @prisma-next/sql-relational-core/ast/driver-types
export interface SqlDriver<TBinding = void> extends SqlQueryable {
  connect(binding: TBinding): Promise<void>;
  acquireConnection(): Promise<SqlConnection>;
  close(): Promise<void>;
}
```

### 3. ExecutionStackInstance.driver

**Current:** No `driver` field; driver is created outside stack instantiation.

**Proposed:** `ExecutionStackInstance` includes `readonly driver: TDriverInstance | undefined` when stack has a driver descriptor. Stack instantiation is complete and env-free.

```ts
// @prisma-next/core-execution-plane/stack
export interface ExecutionStackInstance<...> {
  readonly stack: ExecutionStack<...>;
  readonly target: RuntimeTargetInstance<...>;
  readonly adapter: TAdapterInstance;
  readonly driver: TDriverInstance | undefined;  // NEW
  readonly extensionPacks: readonly TExtensionInstance[];
}
```

### 4. instantiateExecutionStack()

**Current:** Instantiates target, adapter, extensionPacks; skips driver.

**Proposed:** When `stack.driver` is present, call `stack.driver.create()` (no connection args) and include the unbound driver in the returned instance.

### 5. Postgres driver refactor

- `PostgresPoolDriverImpl` and `PostgresDirectDriverImpl` accept connection at construction today.
- **Proposed:** Introduce an unbound driver variant (or single implementation) that stores binding lazily. Constructor accepts only non-connection options (e.g. `cursor`). `connect(binding)` binds pool/client and enables `acquireConnection()` / execution.
- `postgresRuntimeDriverDescriptor.create()` returns unbound driver; no `connect` in options.

### 6. postgres() client runtime() getter

**Current flow:**

1. `instantiateExecutionStack(stack)` → stackInstance (no driver)
2. Resolve binding from options
3. `driverDescriptor.create({ connect, cursor })` → bound driver
4. `createRuntime({ stackInstance, context, driver, ... })`

**Proposed flow:**

1. `instantiateExecutionStack(stack)` → stackInstance with `driver` (unbound)
2. Resolve binding from options
3. `stackInstance.driver.connect(binding)` → driver is now bound
4. `createRuntime({ stackInstance, context, driver: stackInstance.driver, ... })`

### 7. createRuntime()

No change to signature. It still receives `driver: SqlDriver`. The driver is now sourced from `stackInstance.driver` after `connect(binding)` has been called.

Invariant: relational runtime call paths covered by this spec must include a driver descriptor. Runtime wiring should assert `stackInstance.driver` exists before connecting/creating runtime and throw a clear configuration error otherwise.

### 8. createPostgresDriver / createPostgresDriverFromOptions

These legacy/factory helpers are **not retained** as supported paths. They may be used only as temporary intermediate refactoring scaffolding if needed, but must be removed by the end of the PR so the descriptor + `connect(binding)` lifecycle is the only supported runtime-driver path.

## Migration Plan

### Phase 1: Core interface and descriptor updates

1. Update `RuntimeDriverDescriptor.create()` signature (optional `options`, no connection).
2. Update `SqlDriver.connect(binding?: unknown)`.
3. Update `ExecutionStackInstance` and `instantiateExecutionStack()` to include driver.
4. Add ADR or spec section documenting driver terminology.

### Phase 2: Postgres driver

1. Refactor `PostgresPoolDriverImpl` / `PostgresDirectDriverImpl` to support unbound creation.
2. Add `connect(binding: PostgresBinding)` that stores binding and enables execution.
3. Update `postgresRuntimeDriverDescriptor.create()` to take no connection args.

### Phase 3: Wiring and examples

1. Update `postgres()` `runtime()` getter: use `stackInstance.driver`, call `connect(binding)` before `createRuntime`.
2. Update examples (`prisma-next-demo`, `prisma-orm-demo`, `prisma-no-emit`).
3. Remove legacy helper paths (`createPostgresDriver`, `createPostgresDriverFromOptions`) from supported runtime flow.
4. Update integration tests.

### Breaking changes

- Internal refactor; no long-lived shims. Update call sites directly.
- `RuntimeDriverDescriptor.create(options)` callers that pass connection must move connection to `connect()`.
- `instantiateExecutionStack()` return type gains `driver`; callers that manually create driver must switch to `stackInstance.driver` + `connect()`.
- Legacy helper runtime-driver construction paths are removed by end of PR.

## Testing Strategy

- **Unit**
  - `instantiateExecutionStack()` with driver descriptor returns instance with `driver` defined.
  - `driver.create()` with no args returns unbound driver.
  - Postgres driver `connect(binding)` enables `acquireConnection()` and execution.
  - Use-before-connect: execution fails with clear error when `connect()` not called.
- **Integration**
  - Examples run with new flow; `db.runtime()` executes plans successfully.
  - Postgres binding variants (url, pgPool, pgClient) work.
- **Regression**
  - Existing runtime tests pass after migration.

## Acceptance Criteria

- [ ] Runtime drivers can be instantiated without connection info.
- [ ] Connection information is provided only at connect time.
- [ ] Stack instantiation is deterministic and env-free when driver descriptor is present.
- [ ] `ExecutionStackInstance` includes `driver` when stack has driver descriptor.
- [ ] Runtime use-before-connect behavior is fail-fast with a clear error.
- [ ] Example demos work with new wiring.
- [ ] Unit/integration tests cover missing connection binding errors and successful connect + execution.
- [ ] Driver terminology documented in spec and/or ADR.
- [ ] Legacy helper runtime-driver construction paths are removed by end of PR.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Layering/cycles when touching core + drivers | Limit changes to well-defined boundaries; run `pnpm lint:deps`. |
| Runtime behavior drift | Rely on integration tests and demo smoke. |
| Control-plane confusion | Explicitly out of scope; leave control driver unchanged. |
| Future drivers (HTTP, in-memory) | Design shared `SqlDriver.connect(binding?: unknown)` so binding is driver-determined. |

## Visual Assets

No visual assets were provided. The planning `visuals/` directory is empty. Suggested additions for future revision: `current-lifecycle.svg`, `proposed-lifecycle.svg`, `connection-binding-boundary.svg`.

## Existing Code References

- `SqlDriver` — `packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`
- `createExecutionStack` / `instantiateExecutionStack` — `packages/1-framework/1-core/runtime/execution-plane/src/stack.ts`
- `PostgresPoolDriverImpl` / `PostgresDirectDriverImpl` — `packages/3-targets/7-drivers/postgres/src/postgres-driver.ts`
- `postgres()` — `packages/3-targets/8-clients/postgres/src/runtime/postgres.ts`
- `RuntimeDriverDescriptor` — `packages/1-framework/1-core/runtime/execution-plane/src/types.ts`
- `postgresRuntimeDriverDescriptor` — `packages/3-targets/7-drivers/postgres/src/exports/runtime.ts`
- Examples: `examples/prisma-next-demo`, `examples/prisma-orm-demo`, `examples/prisma-no-emit`

## References

- [ADR 152 — Execution Plane Descriptors and Instances](../../../docs/architecture%20docs/adrs/ADR%20152%20-%20Execution%20Plane%20Descriptors%20and%20Instances.md)
- [ADR 159 — Driver Terminology and Lifecycle](../../../docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)
- [Runtime & Plugin Framework subsystem](../../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Plugin%20Framework.md)
- [Postgres one-liner lazy client spec](../2026-02-10-postgres-one-liner-lazy-client/spec.md) (TML-1891, related)
