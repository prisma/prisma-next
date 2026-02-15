# Runtime DX: decouple runtime driver instantiation from connection binding

**Linear issue:** [TML-1837](https://linear.app/prisma-company/issue/TML-1837/runtime-dx-decouple-runtime-driver-instantiation-from-connection)

## Summary

Today, runtime drivers (e.g. Postgres) require connection configuration at *driver instantiation time* (e.g. `{ connect: { pool | client }, cursor }`). This makes `RuntimeDriverDescriptor.create(options)` inherently environment-bound and prevents `instantiateExecutionStack()` from meaningfully instantiating a "complete" stack when a driver descriptor is present.

This ticket proposes **separating driver instantiation from connection binding** so that **connection information is provided only at connect time**. This enables:

* stack instantiation to be fully deterministic and env-free (descriptors → instances)
* connection/pool/client wiring to happen at the boundary where env/runtime configuration is available
* clearer DX: "instantiate stack" vs "connect driver" responsibilities

## Motivation / Background

* Runtime DX foundation (`TML-1834`) introduced `ExecutionStack` + `ExecutionStackInstance` + `ExecutionContext`. The driver is currently the odd component out because it cannot be instantiated without connection options.
* We want a consistent model across stack components: `instantiateExecutionStack()` should be able to instantiate all components in the stack without requiring env access.
* This also aligns with upcoming runtime DX work (`TML-1831`) where we want context construction and other wiring steps to be deterministic and testable.

## Proposed direction (non-binding)

Introduce a runtime driver lifecycle where:

* **Driver descriptor** `create()` produces an *unbound* driver instance (no connection info required)
* **Connection binding occurs only at connect time**, e.g. `driver.connect(connection)` where `connection` can be `{ pool | client }` (or a future abstract transport binding)

This likely requires one of:

* **API change**: update `SqlDriver.connect()` to accept a connection binding (and store it internally)
* or **separate interface**: keep `SqlDriver` minimal, introduce `SqlDriverConnector`/`SqlConnectionProvider` that runtime holds and passes into execution (preferred only if it keeps lane/runtime boundaries clean)

## Scope

* Define the new runtime driver connection binding model (types + lifecycle)
* Update `@prisma-next/sql-relational-core` driver interface(s) accordingly
* Update Postgres runtime driver implementation to match (no connection required in constructor)
* Update runtime creation wiring so connection binding happens via connect-time config
* Update examples and tests to reflect the new flow

## Acceptance criteria

* Runtime drivers can be instantiated without connection info.
* Connection information is provided only at connect time.
* Stack instantiation remains deterministic/env-free even when a driver descriptor is present.
* Example demos still work with the new wiring.
* Unit/integration tests cover both:
  * missing connection binding errors
  * successful connect + execution

## Non-goals

* Changing adapter/target descriptor patterns
* Introducing new targets/drivers beyond Postgres (unless required for shared typing)

## Notes

* This is expected to be a breaking internal refactor; keep migration focused and update call sites directly (no long-lived shims).
