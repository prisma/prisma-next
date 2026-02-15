# Tasks — Runtime DX: Decouple Runtime Driver Instantiation from Connection Binding

Date: 2026-02-15  
Spec: `agent-os/specs/2026-02-15-runtime-dx-decouple-runtime-driver-instantiation-from-connection-binding/spec.md`  
Requirements: `agent-os/specs/2026-02-15-runtime-dx-decouple-runtime-driver-instantiation-from-connection-binding/planning/requirements.md`  
Linear: [TML-1837](https://linear.app/prisma-company/issue/TML-1837/runtime-dx-decouple-runtime-driver-instantiation-from-connection)

---

## Overview

**Total top-level task count:** 31 tasks across 8 groups.

This spec separates **driver instantiation** from **connection binding**. Drivers are created without connection info; binding happens at connect time. Stack instantiation becomes deterministic and env-free.

**Principles:**
- Test-first subtasks before implementation (2–8 tests per group per local convention)
- No backward-compat shims; update call sites directly
- Align with architecture layering; run `pnpm lint:deps` after changes
- Control-plane driver unchanged (out of scope)

**Visual assets:** No visual assets were provided. The `planning/visuals/` directory contains only a README. Suggested additions for future revision: `current-lifecycle.svg`, `proposed-lifecycle.svg`, `connection-binding-boundary.svg`.

---

## Dependencies

```
Group 1 (Core interfaces) ─────────────────────────────────┐
                                                             │
Group 2 (SqlDriver interface) ◄──────────────────────────────┤
                                                             │
Group 3 (Execution stack) ◄─────────────────────────────────┤
                                                             │
Group 4 (Postgres driver) ◄──────────────────────────────────┘
                                                             │
Group 5 (Runtime wiring) ◄──────────────────────────────────┘
                                                             │
Group 6 (Legacy cleanup) ◄──────────────────────────────────┘
                                                             │
Group 7 (Tests — integration) ◄──────────────────────────────┘
                                                             │
Group 8 (Docs/ADR) ◄──────────────────────────────────────────┘
```

Groups 1–4 can be partially parallelized (1 before 2 and 3; 2 before 4). Group 5 depends on 3 and 4. Group 6 depends on 5. Groups 7 and 8 are final validation.

---

## 1. Core interfaces (RuntimeDriverDescriptor, ExecutionStackInstance)

**Goal:** Update `RuntimeDriverDescriptor.create()` to accept optional options with no connection, and add `driver` to `ExecutionStackInstance`.

### 1.1 Tests (test-first)

- [x] **Unit:** `instantiateExecutionStack()` with driver descriptor returns instance with `driver` defined.
- [x] **Unit:** `instantiateExecutionStack()` with no driver descriptor returns instance with `driver` undefined.
- [x] **Type:** `ExecutionStackInstance.driver` type narrows when stack has driver descriptor.

### 1.2 Implementation

- [x] Update `RuntimeDriverDescriptor` in `packages/1-framework/1-core/runtime/execution-plane/src/types.ts`:
  - Add `TCreateOptions` type parameter (default `void`).
  - Change `create(options?: TCreateOptions): TDriverInstance` (optional; no connection required).
- [x] Add `readonly driver: TDriverInstance | undefined` to `ExecutionStackInstance` in `packages/1-framework/1-core/runtime/execution-plane/src/stack.ts`.
- [x] Update `instantiateExecutionStack()` to call `stack.driver.create()` when `stack.driver` is present and include driver in returned instance.
- [x] Run `pnpm -F @prisma-next/core-execution-plane test` and `pnpm lint:deps`.

**Acceptance criteria:** Descriptor `create()` accepts optional options; stack instance includes `driver` when stack has driver descriptor; types compile and tests pass.

---

## 2. SqlDriver interface (connect with binding)

**Goal:** Extend `SqlDriver.connect()` to accept a driver-determined binding parameter. Shared interface does not encode Postgres-specific types.

### 2.1 Tests (test-first)

- [x] **Unit:** `SqlDriver` interface supports `connect(binding: TBinding)` (type-level).
- [x] **Unit:** Mock driver implementing `SqlDriver<PostgresBinding>` compiles and accepts binding at connect.
- [x] **Unit:** Driver with `TBinding = void` has no-arg or no-op connect (if needed for backward compat during migration—spec says no shims, so may be N/A).

### 2.2 Implementation

- [x] Update `SqlDriver` in `packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`:
  - Add `TBinding = void` type parameter.
  - Change `connect(binding: TBinding): Promise<void>`.
- [x] Update all implementers of `SqlDriver` to satisfy the new signature (Postgres driver comes in Group 4).
- [x] Run `pnpm -F @prisma-next/sql-relational-core test` and `pnpm lint:deps`.

**Acceptance criteria:** `SqlDriver<TBinding>` interface has `connect(binding)`; no Postgres-specific types in shared interface; layering preserved.

---

## 3. Execution stack (instantiateExecutionStack, ExecutionStackInstance.driver)

**Goal:** `instantiateExecutionStack()` instantiates the driver when stack has a driver descriptor. Driver is created without connection args.

### 3.1 Tests (test-first)

- [x] **Unit:** `instantiateExecutionStack(stack)` with driver descriptor calls `stack.driver.create()` with no connection args.
- [x] **Unit:** Returned `ExecutionStackInstance.driver` is the unbound driver from descriptor.
- [x] **Unit:** Stack without driver descriptor produces instance with `driver === undefined`.
- [x] **Unit:** `driver.create()` with no args or optional non-connection options returns unbound driver.

### 3.2 Implementation

- [x] Ensure `instantiateExecutionStack()` passes no connection to `stack.driver.create()` (options may include driver-specific non-connection opts like `cursor`).
- [x] Verify `ExecutionStackInstance` type includes `driver` and that `instantiateExecutionStack` populates it.
- [x] Run `pnpm -F @prisma-next/core-execution-plane test` and `pnpm lint:deps`.

**Acceptance criteria:** Stack instantiation is complete and env-free; driver is included when stack has driver descriptor; no connection passed to `create()`.

---

## 4. Postgres driver (unbound create, connect with binding)

**Goal:** Postgres driver is created without connection; `connect(binding)` binds pool/client and enables execution.

### 4.1 Tests (test-first)

- [x] **Unit:** `postgresRuntimeDriverDescriptor.create()` with no args returns unbound driver.
- [x] **Unit:** `driver.connect(binding)` with pool binding enables `acquireConnection()` and execution.
- [x] **Unit:** `driver.connect(binding)` with client binding enables `acquireConnection()` and execution.
- [x] **Unit:** Use-before-connect: execution fails with clear error when `connect()` not called.
- [x] **Unit:** `connect()` called twice with same binding is idempotent or fails gracefully (specify expected behavior).
- [x] **Unit:** Postgres driver `close()` works for both pool and direct client bindings.

### 4.2 Implementation

- [x] Define `PostgresBinding` type (pool | client | url-resolved) in Postgres driver package.
- [x] Refactor `PostgresPoolDriverImpl` and `PostgresDirectDriverImpl` to support unbound creation:
  - Constructor accepts only non-connection options (e.g. `cursor`).
  - Introduce lazy binding stored after `connect(binding)`.
- [x] Implement `connect(binding: PostgresBinding): Promise<void>` that stores binding and enables `acquireConnection()` and execution.
- [x] Update `postgresRuntimeDriverDescriptor.create()` to take no connection args; return unbound driver.
- [x] Add fail-fast error for use-before-connect (execution before `connect()`).
- [x] Run `pnpm -F @prisma-next/driver-postgres test` and `pnpm lint:deps`.

**Acceptance criteria:** Driver is instantiable without connection; `connect(binding)` binds and enables execution; use-before-connect fails with clear error; existing driver tests pass or are updated.

---

## 5. Runtime wiring (postgres() client, createRuntime)

**Goal:** `postgres()` `runtime()` getter uses `stackInstance.driver`, calls `connect(binding)` before `createRuntime`.

### 5.1 Tests (test-first)

- [x] **Unit:** `postgres()` `runtime()` getter calls `stackInstance.driver.connect(binding)` before `createRuntime`.
- [x] **Unit:** `postgres()` throws clear configuration error when stack has no driver descriptor but relational runtime is expected.
- [x] **Unit:** `createRuntime` receives `driver` from `stackInstance.driver` after connect.

### 5.2 Implementation

- [x] Update `postgres()` in `packages/3-targets/8-clients/postgres/src/runtime/postgres.ts`:
  - Instantiate stack via `instantiateExecutionStack(stack)` (stack instance now includes `driver`).
  - Assert `stackInstance.driver` exists; throw configuration error if missing.
  - Resolve binding from options (reuse `resolvePostgresBinding`).
  - Call `stackInstance.driver.connect(binding)` to bind.
  - Pass `driver: stackInstance.driver` to `createRuntime`.
- [x] Ensure `createRuntime` signature unchanged (still receives `driver: SqlDriver`).
- [x] Run `pnpm -F @prisma-next/postgres test` and `pnpm lint:deps`.

**Acceptance criteria:** New flow: instantiate stack → connect driver → create runtime; `postgres().runtime()` executes plans successfully; configuration error when driver descriptor missing.

---

## 6. Examples and integration

**Goal:** Examples run with new flow; integration tests pass.

### 6.1 Implementation

- [x] Update `examples/prisma-next-demo` to use new wiring (if it composes manually; `postgres()` one-liner may already encapsulate).
- [x] Update `examples/prisma-orm-demo` if it uses manual driver/stack wiring.
- [x] Update `examples/prisma-no-emit` if it uses manual driver/stack wiring.
- [x] Run `pnpm test:packages` and `pnpm test:integration`; fix any regressions.

**Acceptance criteria:** All examples run; integration tests pass; demos execute queries successfully.

---

## 7. Legacy helper cleanup

**Goal:** Remove `createPostgresDriver` and `createPostgresDriverFromOptions` from supported runtime path. Descriptor + `connect(binding)` is the only supported path.

### 7.1 Tests (test-first)

- [x] **Unit:** Postgres driver tests use descriptor `create()` + `connect()` path instead of `createPostgresDriverFromOptions`.

### 7.2 Implementation

- [x] Update `packages/3-targets/7-drivers/postgres/test/driver.basic.test.ts` to use descriptor + `connect()`.
- [x] Update `packages/3-targets/7-drivers/postgres/test/driver.errors.test.ts` to use descriptor + `connect()`.
- [x] Remove or deprecate `createPostgresDriver` and `createPostgresDriverFromOptions` from runtime entrypoint `@prisma-next/driver-postgres/runtime` (spec: remove by end of PR).
- [x] Update `packages/3-targets/7-drivers/postgres/README.md` to describe descriptor + `connect()` lifecycle.
- [x] Update `docs/reference/typescript-patterns.md` if it references legacy helpers.
- [x] Update root `README.md` if it references `createPostgresDriver`.
- [x] Run `pnpm test:packages` and `pnpm lint:deps`.

**Acceptance criteria:** Legacy helper runtime-driver construction paths removed; tests use descriptor + `connect()`; README and docs updated.

---

## 8. Docs and ADR

**Goal:** Document driver terminology and lifecycle in spec and/or ADR.

### 8.1 Implementation

- [x] Add ADR or extend spec section documenting:
  - "Driver" = Prisma Next interface (not underlying library like `pg`).
  - All drivers adhere to common interface; instantiation ≠ connection.
  - Connection binding is driver-determined; each driver defines its own binding type.
- [x] Update `docs/architecture docs/subsystems/4. Runtime & Plugin Framework.md` with new connection lifecycle (instantiate stack with driver → connect at boundary → create runtime).
- [x] Update `packages/1-framework/1-core/runtime/execution-plane/README.md` and `packages/3-targets/7-drivers/postgres/README.md` to reflect new flow.
- [x] Ensure ADR 152 or follow-on ADR captures `RuntimeDriverDescriptor.create(options?)` and `SqlDriver.connect(binding)` changes.

**Acceptance criteria:** Driver terminology and lifecycle documented; architecture docs and package READMEs updated; ADR or spec section records the decision.

---

## Verification checklist

Before marking complete:

- [x] `pnpm build` succeeds.
- [⚠️] `pnpm test:packages` passes. (fails in `@prisma-next/integration-kysely`: `Command "prisma-next" not found`)
- [x] `pnpm test:integration` passes.
- [x] `pnpm lint:deps` passes (no layering violations).
- [x] Examples (`prisma-next-demo`, `prisma-orm-demo`, `prisma-no-emit`) run successfully.
- [x] Use-before-connect produces clear, actionable error.
