# Walkthrough: Semantic Changes in `spec/tml-1837-runtime-dx-decouple-driver-instantiation`

This is a narrative walkthrough of **what changed semantically** in this branch (not a diff tour), with links to the relevant code/tests/docs so you can verify each step.

Companion doc: [code-review.md](./code-review.md)

---

## What this branch changes (in one sentence)

It changes the runtime driver lifecycle from **“create(driver + connection)”** to **“create(unbound driver) → connect(binding) → use”**, and makes the execution stack instance include an (unbound) `driver` so stack instantiation is deterministic/env-free.

---

## Before vs after (conceptual)

### Before

- The Postgres runtime driver was effectively **bound at creation time** (connection-ish config flowed into descriptor `create(...)` / driver construction).
- `instantiateExecutionStack(...)` produced a stack instance **without** a driver, and the client/runtime boundary created/passed the driver separately.

### After

- `RuntimeDriverDescriptor.create(options?)` is only allowed to take **driver-specific, non-connection options**.
- `SqlDriver.connect(binding)` becomes the **only place** connection binding is provided.
- `instantiateExecutionStack(...)` now instantiates the driver (unbound) and returns a **complete** `ExecutionStackInstance` including `driver`.
- `postgres().runtime()` resolves the binding, calls `driver.connect(binding)`, then calls `createRuntime(...)`.

---

## 1) Descriptor `create()` is now “unbound, optional options”

### Change

`RuntimeDriverDescriptor` got an explicit `TCreateOptions` type parameter and `create(options?: TCreateOptions)` is now **optionally parameterized** and explicitly **not** for connection binding.

### Where to verify

- `RuntimeDriverDescriptor` definition: [`packages/1-framework/1-core/runtime/execution-plane/src/types.ts`](../../../../packages/1-framework/1-core/runtime/execution-plane/src/types.ts)
- Stack instantiation uses `create()` with **no args**: [`packages/1-framework/1-core/runtime/execution-plane/src/stack.ts`](../../../../packages/1-framework/1-core/runtime/execution-plane/src/stack.ts)
- Unit coverage of `instantiateExecutionStack()` calling `create()` with no args + optional non-connection options: [`packages/1-framework/1-core/runtime/execution-plane/test/stack.test.ts`](../../../../packages/1-framework/1-core/runtime/execution-plane/test/stack.test.ts)

---

## 2) `ExecutionStackInstance` becomes “complete” by including `driver`

### Change

`ExecutionStackInstance` now includes:

- `readonly driver: TDriverInstance | undefined`

And `instantiateExecutionStack(stack)` now instantiates the driver if a driver descriptor is present:

- `const driver = stack.driver ? stack.driver.create() : undefined;`

### Why it matters

This makes stack instantiation **deterministic** and **environment-free**: a fully-instantiated stack instance can be created without any connection details (those come later at connect time).

### Where to verify

- `ExecutionStackInstance.driver` + `instantiateExecutionStack(...)`: [`packages/1-framework/1-core/runtime/execution-plane/src/stack.ts`](../../../../packages/1-framework/1-core/runtime/execution-plane/src/stack.ts)
- Tests for driver-present/driver-absent stacks: [`packages/1-framework/1-core/runtime/execution-plane/test/stack.test.ts`](../../../../packages/1-framework/1-core/runtime/execution-plane/test/stack.test.ts)

---

## 3) `SqlDriver.connect(binding)` is now generic and driver-determined

### Change

`SqlDriver` is now parameterized as `SqlDriver<TBinding = void>` and `connect(binding: TBinding)` takes a **driver-determined binding type**, avoiding Postgres-specific details in the shared interface.

### Where to verify

- Interface: [`packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`](../../../../packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts)
- Test demonstrating `TBinding = void` accepts `connect(undefined)`: [`packages/2-sql/4-lanes/relational-core/test/ast/driver-types.test.ts`](../../../../packages/2-sql/4-lanes/relational-core/test/ast/driver-types.test.ts)

---

## 4) Postgres runtime driver is now explicitly “unbound until connect”

### Change

The Postgres driver package introduces a **binding union** and a runtime driver implementation that starts in an unbound state:

- `PostgresBinding` is a discriminated union (`url` | `pgPool` | `pgClient`)
- `postgresRuntimeDriverDescriptor.create(...)` returns an unbound driver (`PostgresUnboundDriverImpl`)
- `connect(binding)` initializes the real, bound driver implementation internally
- Calls before `connect(...)` fail fast with a clear error

### Where to verify

- Binding type + bound driver constructors + binding→driver factory:
  - [`packages/3-targets/7-drivers/postgres/src/postgres-driver.ts`](../../../../packages/3-targets/7-drivers/postgres/src/postgres-driver.ts)
    - `PostgresBinding`
    - `createBoundDriverFromBinding(...)`
- Unbound runtime driver + fail-fast message + descriptor `create(...)`:
  - [`packages/3-targets/7-drivers/postgres/src/exports/runtime.ts`](../../../../packages/3-targets/7-drivers/postgres/src/exports/runtime.ts)
- Unit tests that prove the lifecycle:
  - [`packages/3-targets/7-drivers/postgres/test/driver.unbound.test.ts`](../../../../packages/3-targets/7-drivers/postgres/test/driver.unbound.test.ts)
    - “use before connect” errors for `acquireConnection`, `query`, and `execute(...)`
    - connect with `pgPool`, `pgClient`, and `url`
    - idempotent `connect` + `close`

### Semantic outcome

You can now instantiate the driver as part of stack instantiation (deterministically), and the boundary that *does* have environment/runtime configuration is responsible for calling `connect(binding)` before any query execution.

---

## 5) `postgres()` client wiring now follows instantiate → connect → createRuntime

### Change

`postgres()` continues to be a lazy client (static surfaces available immediately; runtime built on first `runtime()` call), but the runtime wiring now:

- creates a stack **with a driver descriptor**
- on first `runtime()`:
  - instantiates the stack (`instantiateExecutionStack(stack)`) which includes an unbound `driver`
  - resolves binding from options
  - calls `driver.connect(binding)`
  - calls `createRuntime({ ..., driver })`

It also provides a `cursor` option and threads it into the driver descriptor `create(...)` path.

### Where to verify

- Client implementation:
  - [`packages/3-targets/8-clients/postgres/src/runtime/postgres.ts`](../../../../packages/3-targets/8-clients/postgres/src/runtime/postgres.ts)
    - stack creation w/ driver descriptor
    - `runtime()` method instantiation + `driver.connect(binding)` + `createRuntime(...)`
    - `cursor` passthrough via descriptor `create({ cursor })`
- Unit tests asserting call order + binding variants + cursor passthrough:
  - [`packages/3-targets/8-clients/postgres/test/postgres.test.ts`](../../../../packages/3-targets/8-clients/postgres/test/postgres.test.ts)
    - connect before createRuntime
    - url vs pg pool vs pg client binding
    - cursor options passed to driver descriptor `create(...)`

---

## 6) SQL runtime context types reflect “stack can include a driver descriptor”

### Change

The SQL runtime’s stack typing (`SqlExecutionStackWithDriver`) is aligned with the execution-plane changes: it models a stack whose `driver` is a `RuntimeDriverDescriptor | undefined`, and runtime driver instances remain `SqlDriver`-compatible.

### Where to verify

- SQL runtime context definitions:
  - [`packages/2-sql/5-runtime/src/sql-context.ts`](../../../../packages/2-sql/5-runtime/src/sql-context.ts)
    - `SqlExecutionStackWithDriver`
    - `SqlRuntimeDriverInstance` (still `SqlDriver`-compatible)
    - `createSqlExecutionStack(...)` passes `driver` through into `createExecutionStack(...)`

---

## 7) Legacy helper removal: descriptor + connect is the supported runtime path

### Change

The branch removes the legacy “create driver from options” helper path from the supported runtime flow, and updates tests to use the descriptor lifecycle.

### Where to verify

- Driver runtime export and public surface:
  - [`packages/3-targets/7-drivers/postgres/src/exports/runtime.ts`](../../../../packages/3-targets/7-drivers/postgres/src/exports/runtime.ts)
- Driver tests updated to the descriptor + connect flow:
  - [`packages/3-targets/7-drivers/postgres/test/driver.basic.test.ts`](../../../../packages/3-targets/7-drivers/postgres/test/driver.basic.test.ts)
  - [`packages/3-targets/7-drivers/postgres/test/driver.errors.test.ts`](../../../../packages/3-targets/7-drivers/postgres/test/driver.errors.test.ts)

---

## 8) Examples + integration tests were migrated to the new lifecycle

### Change

Branch updates demos and integration tests to match “instantiate stack → connect(binding) → run”.

### Where to verify

- Example entrypoints and runtime setup:
  - [`examples/prisma-next-demo/src/main.ts`](../../../../examples/prisma-next-demo/src/main.ts)
  - [`examples/prisma-next-demo/src/main-no-emit.ts`](../../../../examples/prisma-next-demo/src/main-no-emit.ts)
  - [`examples/prisma-orm-demo/src/prisma-next/runtime.ts`](../../../../examples/prisma-orm-demo/src/prisma-next/runtime.ts)
- Integration tests (smoke-level validation of the new runtime behavior):
  - [`test/integration/test/runtime.test.ts`](../../../../test/integration/test/runtime.test.ts)
  - [`test/integration/test/kysely.test.ts`](../../../../test/integration/test/kysely.test.ts)
  - (and the other edited tests under [`test/integration/test/`](../../../../test/integration/test/))

---

## 9) Docs/ADR updates codify terminology + lifecycle

### Change

The branch codifies “driver” terminology and lifecycle (instantiation ≠ connection) and updates subsystem + package READMEs to match.

### Where to verify

- ADR 159 (terminology and lifecycle):
  - [`docs/architecture docs/adrs/ADR 159 - Driver Terminology and Lifecycle.md`](../../../../docs/architecture%20docs/adrs/ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)
- ADR 152 updated to reference ADR 159:
  - [`docs/architecture docs/adrs/ADR 152 - Execution Plane Descriptors and Instances.md`](../../../../docs/architecture%20docs/adrs/ADR%20152%20-%20Execution%20Plane%20Descriptors%20and%20Instances.md)
- Runtime subsystem doc updated to show instantiate → connect → create:
  - [`docs/architecture docs/subsystems/4. Runtime & Plugin Framework.md`](../../../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Plugin%20Framework.md)
- Package READMEs updated:
  - [`packages/1-framework/1-core/runtime/execution-plane/README.md`](../../../../packages/1-framework/1-core/runtime/execution-plane/README.md)
  - [`packages/3-targets/7-drivers/postgres/README.md`](../../../../packages/3-targets/7-drivers/postgres/README.md)
  - [`packages/3-targets/8-clients/postgres/README.md`](../../../../packages/3-targets/8-clients/postgres/README.md)

---

## “Start here” quick link list

- **Execution-plane primitives**: [`packages/1-framework/1-core/runtime/execution-plane/src/stack.ts`](../../../../packages/1-framework/1-core/runtime/execution-plane/src/stack.ts)
- **Driver descriptor type change**: [`packages/1-framework/1-core/runtime/execution-plane/src/types.ts`](../../../../packages/1-framework/1-core/runtime/execution-plane/src/types.ts)
- **Shared driver interface change**: [`packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`](../../../../packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts)
- **Postgres unbound driver + descriptor**: [`packages/3-targets/7-drivers/postgres/src/exports/runtime.ts`](../../../../packages/3-targets/7-drivers/postgres/src/exports/runtime.ts)
- **Postgres binding and bound driver implementations**: [`packages/3-targets/7-drivers/postgres/src/postgres-driver.ts`](../../../../packages/3-targets/7-drivers/postgres/src/postgres-driver.ts)
- **postgres() wiring**: [`packages/3-targets/8-clients/postgres/src/runtime/postgres.ts`](../../../../packages/3-targets/8-clients/postgres/src/runtime/postgres.ts)
- **Driver lifecycle tests**: [`packages/3-targets/7-drivers/postgres/test/driver.unbound.test.ts`](../../../../packages/3-targets/7-drivers/postgres/test/driver.unbound.test.ts)
- **Client wiring tests**: [`packages/3-targets/8-clients/postgres/test/postgres.test.ts`](../../../../packages/3-targets/8-clients/postgres/test/postgres.test.ts)

