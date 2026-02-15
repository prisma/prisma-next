# Spec Requirements: Runtime DX — Decouple Runtime Driver Instantiation from Connection Binding

## Initial Description

Today, runtime drivers (e.g. Postgres) require connection configuration at *driver instantiation time* (e.g. `{ connect: { pool | client }, cursor }`). This makes `RuntimeDriverDescriptor.create(options)` inherently environment-bound and prevents `instantiateExecutionStack()` from meaningfully instantiating a "complete" stack when a driver descriptor is present.

This ticket proposes **separating driver instantiation from connection binding** so that **connection information is provided only at connect time**. This enables:

* stack instantiation to be fully deterministic and env-free (descriptors → instances)
* connection/pool/client wiring to happen at the boundary where env/runtime configuration is available
* clearer DX: "instantiate stack" vs "connect driver" responsibilities

## Requirements Discussion

### First Round Questions

**Q1:** Should the connect-time binding be exactly `{ pool | client }`, or do we need a more generic `SqlConnectionBinding` union (URL, pool, client, future variants) to avoid API churn when adding new binding types?

**Answer:** I'll need some help designing a solution here because I'm not very familiar with common driver patterns. We must be cautious here not to encode Postgres specifics into our solution. Pool vs client are pg concepts. We will also want to support totally different execution models, like communication over HTTP from within a web browser context, or writing to memory for a test environment, eg. With that in mind, my instinct is that the connection input ought to be driver-determined. Wdyt?

**Q2:** Should `ExecutionStackInstance` gain a `driver` field so the stack is "complete" at instantiation time, or should the driver remain outside the stack instance and only be created/bound at the boundary (e.g. in `postgres()`'s `runtime()` getter) before being passed into `createRuntime()`?

**Answer:** Correct. I've run into a small misconception with my team repeatedly, which I'd like recorded here in the spec documents or otherwise in an ADR, which is that "driver" in our terminology refers to a Prisma Next interface, not the underlying library instance (like pg). We expect to be able to _instantiate_ a driver without connecting to anything. Furthermore we expect all drivers to adhere to a common interface (the one we're talking about). I expect stack instantiation to be highly predictable, and I'd like driver instantiation to behave like the other components. Connection lifecycle is independent of instantiation.

**Q3:** Should `cursor` (and other non-connection options) remain at `create()` time, or move to `connect()`? If they stay at create time, should the descriptor `create()` accept an optional bag (e.g. `create({ cursor })`) or no arguments?

**Answer:** I don't know what `cursor` means, but it sounds driver-specific.

**Q4:** What should happen if a plan is executed before `connect()` has been called—fail fast with a clear error, or support lazy connect (e.g. from a connection factory passed at connect time)?

**Answer:** Let the runtime manage connection semantics

**Q5:** Should the control-plane Postgres driver (`control.ts`) remain unchanged (create still means connect), or should the decoupled lifecycle apply there too for consistency?

**Answer:** I don't understand

**Q6:** Please provide sequence diagrams or architecture diagrams for current vs proposed lifecycle under `agent-os/specs/2026-02-15-runtime-dx-decouple-runtime-driver-instantiation-from-connection-binding/visuals/`.

**Answer:** Correct

**Q7:** Existing Code Reuse—confirm reuse boundaries (SqlDriver interface, createExecutionStack/instantiateExecutionStack, Postgres driver impls, postgres() client, descriptor types, examples).

**Answer:** Yes

**Q8:** Any other exclusions beyond the stated non-goals?

**Answer:** --

### Existing Code to Reference

**Similar Features Identified:**
- `SqlDriver` interface in `packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts` — extend `connect()` signature, do not replace
- `createExecutionStack` / `instantiateExecutionStack` in `packages/1-framework/1-core/runtime/execution-plane/src/stack.ts` — update to include driver in stack instance
- `PostgresPoolDriverImpl` and `PostgresDirectDriverImpl` in `packages/3-targets/7-drivers/postgres/src/postgres-driver.ts` — refactor to defer connection binding
- `postgres()` in `packages/3-targets/8-clients/postgres/src/runtime/postgres.ts` — update wiring so connection binding happens at connect time in `runtime()` getter
- `RuntimeDriverDescriptor.create()` in `packages/1-framework/1-core/runtime/execution-plane/src/types.ts` — refactor signature
- `postgresRuntimeDriverDescriptor` in `packages/3-targets/7-drivers/postgres/src/exports/runtime.ts` — update to create unbound driver
- Examples: `examples/prisma-next-demo`, `examples/prisma-orm-demo`, `examples/prisma-no-emit` — update to new flow

### Follow-up Questions

None asked.

## Visual Assets

### Files Provided:

No visual assets provided.

### Visual Insights:

No visual assets provided.

## Requirements Summary

### Functional Requirements

- Runtime drivers are instantiable without connection info (descriptor `create()` returns unbound driver)
- Connection binding is driver-determined: each driver defines its own binding type (Postgres: pool/client; future: HTTP, in-memory, etc.)
- Connection lifecycle is independent of driver instantiation
- `ExecutionStackInstance` includes a `driver` field; stack instantiation is complete and deterministic
- Driver options like `cursor` are driver-specific and not part of the generic interface
- Runtime manages connection semantics (when to connect, error handling for use-before-connect)
- Document in spec and/or ADR: "driver" means Prisma Next interface, not underlying library (e.g. pg); all drivers adhere to common interface; instantiation ≠ connection

### Reusability Opportunities

- Extend `SqlDriver.connect()` to accept a driver-determined binding parameter instead of requiring connection at construct/create time
- Refactor Postgres driver to hold connection binding lazily; connection passed at `connect()` call
- Update `instantiateExecutionStack()` to call `driver.create()` (no connection args) and include driver in returned instance
- Update `postgres()` client and examples to bind connection at connect-time boundary

### Scope Boundaries

**In Scope:**
- Define runtime driver connection binding model (types + lifecycle)
- Update `@prisma-next/sql-relational-core` driver interface(s)
- Update Postgres runtime driver to create unbound, bind at connect time
- Update runtime creation wiring
- Add driver to `ExecutionStackInstance`
- Update examples and tests
- Document driver terminology and lifecycle (spec and/or ADR)

**Out of Scope:**
- Changing adapter/target descriptor patterns
- Introducing new targets/drivers beyond Postgres (unless needed for shared typing)
- Control plane driver changes (per Q5 non-understanding, leave unchanged per spec non-goals)
- MySQL/SQLite or other future drivers
- Public API changes to `postgres()` beyond connection binding flow
- Transaction or connection pooling behavior changes

### Technical Considerations

- Connection input is driver-determined: avoid encoding Postgres (pool/client) into generic interfaces; support future bindings (HTTP, in-memory for tests)
- `cursor` is driver-specific: not part of generic descriptor `create()`; Postgres may accept it as driver-specific option at connect or elsewhere
- Runtime manages connection semantics: fail-fast vs lazy connect is a runtime concern
- `instantiateExecutionStack()` must call `driver.create()` with no connection args when driver descriptor present
- Breaking internal refactor; update call sites directly, no long-lived shims
