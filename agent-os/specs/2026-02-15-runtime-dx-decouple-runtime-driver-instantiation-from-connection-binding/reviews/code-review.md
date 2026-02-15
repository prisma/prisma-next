# Code Review: TML-1837 Runtime DX — Decouple Driver Instantiation from Connection Binding

**Date:** 2026-02-15  
**Spec:** [spec.md](../spec.md) | [tasks.md](../tasks.md)  
**Linear:** [TML-1837](https://linear.app/prisma-company/issue/TML-1837)

---

## Summary Verdict

**Ship with nits.** The implementation meets spec acceptance criteria and aligns with the architecture. Remaining items are minor: end-to-end `connect(binding)` type-safety is weaker than the spec implies (type erasure + duplicate binding types), `PostgresDriverOptions` is still exported from the runtime surface, and the known `@prisma-next/integration-kysely` CI failure (pre-existing, unrelated to this PR).

---

## Scope Reviewed

- **Base branch:** `tml-1890-runtime-dx-postgres-one-liner-lazy-client-prisma`
- **Range:** 22 commits, `f0889d10..f5985da1`
- **Files:** Core execution-plane, sql-relational-core, driver-postgres, postgres client, sql-context, examples, integration tests, ADRs 152/159, subsystem and package READMEs

---

## Spec Adherence Checklist

| Acceptance Criterion | Evidence |
|----------------------|----------|
| Runtime drivers instantiable without connection info | `postgresRuntimeDriverDescriptor.create()` returns `PostgresUnboundDriverImpl`; no connection in `create()` args. `RuntimeDriverDescriptor.create(options?: TCreateOptions)` in `types.ts`. |
| Connection info provided only at connect time | `driver.connect(binding)` in postgres runtime getter; `SqlDriver.connect(binding: TBinding)` in driver-types.ts. |
| Stack instantiation deterministic and env-free when driver descriptor present | `instantiateExecutionStack()` calls `stack.driver.create()` with no args; no env access in stack creation. |
| `ExecutionStackInstance` includes `driver` when stack has driver descriptor | `readonly driver: TDriverInstance` or `undefined` in `ExecutionStackInstance`; populated by `instantiateExecutionStack()`. |
| Use-before-connect fail-fast with clear error | `USE_BEFORE_CONNECT_MESSAGE` in `PostgresUnboundDriverImpl`; `acquireConnection`, `query`, `execute`, `explain` all check `#delegate === null` and throw. |
| Example demos work with new wiring | Examples updated; `postgres().runtime()` uses `stackInstance.driver` + `connect(binding)`. Integration tests pass. |
| Unit/integration tests cover missing connection and successful connect | `driver.unbound.test.ts` covers use-before-connect; `driver.basic.test.ts`, `driver.errors.test.ts` use descriptor + connect; integration tests pass. |
| Driver terminology documented | ADR 159 added; spec, READMEs, subsystem doc updated; ADR 152 links to ADR 159. |
| Legacy helper paths removed | `createPostgresDriver` and `createPostgresDriverFromOptions` no longer exported or used; grep finds only spec/tasks references. |

---

## Major Findings (Must-Fix)

None. Implementation meets acceptance criteria.

---

## Minor Findings / Nits

### 1. Cursor options passthrough is implemented, but shape/typing warrants a quick check

The spec allows driver-specific options (e.g. `cursor`) at `create()` time. This branch does wire `cursor` through `postgres()` by wrapping the driver descriptor's `create()` and passing `{ cursor: options.cursor }` into `postgresDriver.create(...)`.

**Nit:** The cursor option shape is defined in `PostgresDriverCreateOptions` (driver package). There is a unit test that appears to pass an example cursor object with keys that don’t match the current driver option shape; if that’s intentional “opaque passthrough”, the types may need loosening, otherwise the test data should match the supported fields.

### 2. Type narrowing test for `driver` when stack has driver descriptor

`stack.types.test-d.ts` asserts `instanceWithDriver.driver` is `MockDriverInstance | undefined` but does not assert that when `stack.driver` is defined, `instance.driver` is narrowed to non-undefined in a way that avoids `!` at call sites. The spec expects "type narrows when stack has driver descriptor." The `postgres()` runtime getter uses `const driver = stackInstance.driver; if (driver === undefined) throw ...` — narrowing works at runtime but a type-level test would strengthen confidence.

### 3. `PostgresDriverOptions` still exported and used in test utils

`PostgresDriverOptions` (with `connect: { pool | client }`) remains exported from driver-postgres runtime. Integration test utils use it as a convenience shape and convert via `bindingFromDriverOptions`. This is acceptable — it’s a test helper, not the production path — but `PostgresDriverOptions` is documented as legacy in spec. Consider renaming to `LegacyPostgresDriverOptions` or moving it to a test-only export if you want to signal it’s not for app code.

### 4. `TBinding = void` and `connect(undefined)`

`SqlDriver<TBinding>` with `TBinding = void` requires `connect(binding: void)`. Callers use `connect(undefined)`. The relational-core test covers this; the type is correct but slightly unusual. No change needed.

---

## Feedback Disposition (2026-02-15)

### 1. Cursor options not exposed via `postgres()` options

**Status:** ✅ Addressed

- Added `cursor?: PostgresDriverCreateOptions['cursor']` to `PostgresOptionsBase` in `packages/3-targets/8-clients/postgres/src/runtime/postgres.ts`.
- Wired cursor options through driver descriptor creation by wrapping `postgresDriver.create({ cursor })` when cursor options are provided.
- Added unit coverage in `packages/3-targets/8-clients/postgres/test/postgres.test.ts` verifying cursor options are forwarded to descriptor `create()`.

### 2. Type narrowing test for `driver` when stack has driver descriptor

**Status:** ✅ Addressed

- Strengthened `packages/1-framework/1-core/runtime/execution-plane/test/stack.types.test-d.ts` with an explicit narrowing assertion:
  - after `if (driver === undefined) throw`, type-level assertion verifies `driver` is `MockDriverInstance`.

### 3. `PostgresDriverOptions` still exported and used in test utils

**Status:** ⚠️ Intentionally unchanged

- **Reason to ignore for this spec:** this export is currently used by test utilities for migration/compatibility glue and is not part of the production runtime path introduced by TML-1837.
- Renaming/removing it now would broaden scope and force follow-up churn in unrelated test helpers. We can handle this as a dedicated cleanup task if we want stricter signaling (e.g. rename to `LegacyPostgresDriverOptions`).

### 4. `TBinding = void` and `connect(undefined)`

**Status:** ⚠️ Intentionally unchanged

- **Reason to ignore for this spec:** current typing is deliberate and validated by tests in relational-core; changing this would require a broader interface design pass across all drivers.
- No functional or safety issue was identified.

---

## Test Review

- **Coverage:** Strong. `stack.test.ts` covers driver/no-driver stacks, create-with-optional-opts. `driver.unbound.test.ts` covers unbound create, use-before-connect (acquireConnection, query, execute), connect+execute for pool/client/url, idempotent connect, close. `driver.errors.test.ts` and `driver.basic.test.ts` use descriptor + connect. `postgres.test.ts` mocks the flow and asserts `driver.connect(binding)` before `createRuntime`, config error when driver missing, binding variants.
- **Clarity:** Test names follow convention (no "should"); descriptions are direct.
- **Determinism:** Uses pg-mem for isolated Postgres; no obvious flakiness.
- **Gap:** No test asserting double-connect with *different* bindings — spec says "idempotent or fails gracefully" for same binding; different bindings are untested. Low risk given current impl (second connect is no-op when delegate exists).

---

## Docs Review

- **ADR 159:** Clear terminology, lifecycle (instantiate → connect → create runtime), interface changes.
- **ADR 152:** Updated to reference ADR 159.
- **Runtime subsystem doc:** Example shows `instantiateExecutionStack` → `driver.connect` → `createRuntime`; "Phase 2" description matches new flow.
- **driver-postgres README:** Descriptor + connect usage, binding variants, ADR 159 link.
- **core-execution-plane README:** Execution stack example with unbound driver and connect-at-boundary.
- **typescript-patterns.md:** No legacy helper references found.
- **Root README:** Not checked in detail; tasks say it was updated if it referenced `createPostgresDriver`.

---

## Suggested Follow-ups

1. **Integration-kysely CI:** `pnpm -F @prisma-next/integration-kysely test` fails with `Command "prisma-next" not found` in `emit:check` (pre-test step). This predates TML-1837. Fix CLI/bin discovery so `prisma-next` is available when integration-kysely runs (e.g. via `pnpm build` order or workspace bin linking).
2. **Cursor options in postgres():** Add `cursor?: PostgresDriverCreateOptions['cursor']` to `PostgresOptionsBase` and pass it into descriptor `create()` when instantiating the stack, or document the current limitation.
3. **Connect-twice-with-different-binding:** Add a test or document that calling `connect(b)` twice with different bindings leaves the first binding active (current behavior).
4. **Visual assets:** Spec suggested `current-lifecycle.svg`, `proposed-lifecycle.svg`; these were not added. Consider adding for onboarding.

---

## CI Readiness

- **`pnpm build`:** Succeeds (per tasks).
- **`pnpm test:packages`:** Succeeds except `@prisma-next/integration-kysely` due to `prisma-next` CLI not found in `emit:check` — **pre-existing**, not introduced by this PR.
- **`pnpm test:integration`:** Passes (per tasks).
- **`pnpm lint:deps`:** Passes (per tasks).
