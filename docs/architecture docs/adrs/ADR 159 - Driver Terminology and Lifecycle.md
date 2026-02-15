# ADR 159 — Driver Terminology and Lifecycle

**Status:** Implemented
**Date:** 2026-02-15
**Domain:** Runtime, Drivers

## Context

Runtime drivers previously required connection configuration at instantiation time. `RuntimeDriverDescriptor.create(options)` expected connection data (e.g. Postgres pool/client), making stack instantiation environment-bound. `instantiateExecutionStack()` could not create a complete stack; the driver was created later at the boundary where env was available, diverging from target/adapter/extension patterns where instantiation is deterministic and env-free.

We need clear terminology and a lifecycle that separates driver instantiation from connection binding so the stack can be fully instantiated without env access.

## Terminology

- **Driver**: In Prisma Next, "driver" refers to the Prisma Next interface implementing execution behavior—*not* the underlying library (e.g. `pg`). All drivers adhere to a common interface (`SqlDriver` for SQL). Instantiation does not imply connection.

- **Connection binding**: Driver-determined configuration that wires the driver to a transport (e.g. Postgres: pool/client; future: HTTP, in-memory). Each driver defines its own binding type.

## Decision

### Lifecycle

1. **Instantiate stack**: `instantiateExecutionStack(stack)` creates target, adapter, driver (unbound), and extension packs. No connection or env access.
2. **Connect at boundary**: Caller resolves binding from options and calls `driver.connect(binding)`.
3. **Create runtime**: `createRuntime({ stackInstance, context, driver: stackInstance.driver, ... })` receives the now-bound driver.

### Interface changes

- `RuntimeDriverDescriptor.create(options?: TCreateOptions)`: Optional options, no connection. Returns unbound driver.
- `SqlDriver.connect(binding: TBinding)`: Driver-determined binding type. Enables `acquireConnection()` and execution.
- `ExecutionStackInstance.driver`: Present when stack has driver descriptor. Stack instantiation is complete.

### Boundary

Connection binding happens at the boundary where env/runtime configuration is available (e.g. `postgres().runtime()` getter). Use-before-connect fails fast with a clear error.

## Consequences

- Stack instantiation is deterministic and env-free when driver descriptor is present.
- Driver terminology is explicit: driver = Prisma Next interface; binding = driver-determined transport wiring.
- Aligns runtime drivers with target/adapter/extension behavior.
- Future drivers (HTTP, in-memory) can define their own binding types via `SqlDriver<TBinding>`.

## References

- [ADR 152 — Execution Plane Descriptors and Instances](./ADR%20152%20-%20Execution%20Plane%20Descriptors%20and%20Instances.md)
- [Runtime & Plugin Framework](../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Plugin%20Framework.md)
