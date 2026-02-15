# Code Review: TML-1837 Runtime DX — Decouple Driver Instantiation from Connection Binding

**Date:** 2026-02-15  
**Spec:** [spec.md](../spec.md) | [tasks.md](../tasks.md)  
**Linear:** [TML-1837](https://linear.app/prisma-company/issue/TML-1837)

---

## Summary Verdict

**Needs follow-ups (design + clarity).** Functional acceptance criteria are largely met, but multiple issues materially undermine the design’s goals (DX, type-safety, and learnability): create-options require descriptor wrapping without being documented as a first-class pattern, `connect(binding)` type-safety is not preserved end-to-end, binding types are duplicated, the legacy `PostgresDriverOptions` remains exported from the runtime surface, and key lifecycle tests are hard to read without consulting implementation. The known `@prisma-next/integration-kysely` CI failure is pre-existing and unrelated.

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

### 1. Driver lifecycle documentation was not accessible (ADR 159)

The original ADR 159 was too compressed to serve its purpose: it did not define the driver lifecycle in a way that a new team member (or even the spec author) could reliably apply without reading implementation. This is a correctness risk over time: the design will be reinterpreted inconsistently.

**Update:** ADR 159 has been rewritten to explicitly define vocabulary, responsibilities/boundaries, a state model, and concrete sequencing.

### 2. Legacy `PostgresDriverOptions` export conflicts with “descriptor + connect is the path”

Keeping a legacy `{ connect: { pool | client } }` options type exported from the runtime surface is a strong affordance for the old mental model and invites accidental usage in app code. If the design goal is a clean lifecycle, this should be removed and tests/utilities updated.

---

## Design / API Findings

### 1. Driver `create(options?)`: options exist, but stack instantiation can’t pass them directly

`RuntimeDriverDescriptor.create(options?: TCreateOptions)` supports driver-specific, non-connection options at create time. But `instantiateExecutionStack()` always calls `stack.driver.create()` with no args, so callers cannot pass create options “through” stack instantiation.

This branch’s workaround pattern is to **curry options into the descriptor** before it enters the stack. `postgres()` does this by creating an inline descriptor wrapper whose `create()` calls `postgresDriver.create({ cursor: options.cursor })`.

**Nit:** The pattern is correct but not obvious without reading `postgres()`; documenting it (or providing an alternative instantiation API) would reduce confusion.

### 2. Cursor options passthrough works, but the test data doesn’t reflect the actual option shape

Cursor options are forwarded from `postgres()` to the driver descriptor `create(...)`.

**Nit:** The cursor option shape is defined in `PostgresDriverCreateOptions` (driver package). The forwarding unit test passes an example cursor object with keys that don’t match that shape; if cursor options are meant to be strictly typed, the test data should use supported keys (e.g. `batchSize` / `disabled`). If they’re meant to be opaque passthrough, the typing should be loosened intentionally.

### 3. Type narrowing test for `driver` when stack has driver descriptor (addressed)

**Update:** The follow-up `stack.types.test-d.ts` now includes an explicit narrowing assertion after `if (driver === undefined) throw`, verifying the narrowed type is `MockDriverInstance`.

### 4. `connect(binding)` call-site type-safety is weaker than the spec implies

The shared interface supports driver-determined binding via `SqlDriver<TBinding>`, but `TBinding` is not preserved through the SQL runtime stack types, so `postgres().runtime()` doesn’t get strong compile-time coupling between the binding returned by `resolvePostgresBinding(...)` and the driver’s `connect(...)` parameter type.

This currently works via structural typing, but it’s a notable gap versus the spec’s “compile-time type safety at driver call sites” intent.

### 5. Duplicate `PostgresBinding` type definitions (client vs driver package)

`PostgresBinding` is defined in both the Postgres client (`packages/3-targets/8-clients/postgres/src/runtime/binding.ts`) and the Postgres driver package (`packages/3-targets/7-drivers/postgres/src/postgres-driver.ts`). They are structurally identical today, but duplication invites drift and contributes to weaker type-safety at the `connect(binding)` call site.

### 6. `PostgresDriverOptions` legacy export remains on the runtime surface

Even if primarily used by tests/utilities, exporting legacy `{ connect: { pool | client } }` options from the runtime surface invites accidental use and contradicts the “descriptor + connect is the supported path” story.

**Recommendation:** delete the legacy runtime export and update tests/utilities to use `PostgresBinding` directly.

### 7. “Unbound vs bound” driver semantics + test readability

The unbound Postgres driver instance is **not replaced** after connect; it keeps identity and stores a private delegate created on first `connect(binding)`. The term “bound driver” here refers to the internal delegate implementation that has been bound to a specific pool/client/url.

The `driver.unbound.test.ts` suite validates the lifecycle, but it reads as a set of independent assertions; it could be restructured with more narrative grouping (“given an unbound driver… when connected… then…”) for readability.

### 8. `TBinding = void` and `connect(undefined)`

`SqlDriver<TBinding>` with `TBinding = void` requires `connect(binding: void)`, so callers use `connect(undefined)`. The relational-core test covers this; the type is correct but slightly unusual. No change needed.

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

**Status:** ✅ Addressed

- Removed `PostgresDriverOptions` from runtime exports in `packages/3-targets/7-drivers/postgres/src/exports/runtime.ts`.
- Updated integration test utilities to stop importing the legacy runtime type:
  - `test/integration/test/utils.ts` now uses a local `IntegrationDriverOptions` helper type and still converts to `PostgresBinding` for `driver.connect(binding)`.
- Updated `packages/3-targets/7-drivers/postgres/README.md` runtime exports list to remove `PostgresDriverOptions`.

### 4. `TBinding = void` and `connect(undefined)`

**Status:** ⚠️ Intentionally unchanged

- **Reason to ignore for this spec:** current typing is deliberate and validated by tests in relational-core; changing this would require a broader interface design pass across all drivers.
- No functional or safety issue was identified.

### 5. Duplicate `PostgresBinding` type definitions (client vs driver package)

**Status:** ✅ Addressed

- Removed the client-local `PostgresBinding` declaration from `packages/3-targets/8-clients/postgres/src/runtime/binding.ts`.
- The client now imports `PostgresBinding` from `@prisma-next/driver-postgres/runtime`, so there is a single canonical binding type source for runtime connect calls.

### 6. Duplicate type import in postgres runtime entrypoint

**Status:** ✅ Addressed

- Removed duplicate `PostgresDriverCreateOptions` import in `packages/3-targets/8-clients/postgres/src/runtime/postgres.ts`.

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
- **ADR 159 sequencing note:** The numbered lifecycle steps (instantiate stack → connect at boundary → create runtime) are consistent with the later prose (“binding happens at the boundary… use-before-connect fails fast”). The prose is a restatement/elaboration, not a competing sequence.
- **Runtime subsystem doc:** Example shows `instantiateExecutionStack` → `driver.connect` → `createRuntime`; "Phase 2" description matches new flow.
- **driver-postgres README:** Descriptor + connect usage, binding variants, ADR 159 link.
- **core-execution-plane README:** Execution stack example with unbound driver and connect-at-boundary.
- **typescript-patterns.md:** No legacy helper references found.
- **Root README:** Not checked in detail; tasks say it was updated if it referenced `createPostgresDriver`.

---

## Suggested Follow-ups

1. **Integration-kysely CI:** `pnpm -F @prisma-next/integration-kysely test` fails with `Command "prisma-next" not found` in `emit:check` (pre-test step). This predates TML-1837. Fix CLI/bin discovery so `prisma-next` is available when integration-kysely runs (e.g. via `pnpm build` order or workspace bin linking).
2. **Preserve `TBinding` through runtime stack types:** Parameterize `SqlRuntimeDriverInstance` / `SqlExecutionStackWithDriver` to retain the driver’s binding type so `connect(binding)` is strongly type-checked at call sites.
3. **Connect-twice-with-different-binding:** Add a test or document that calling `connect(b)` twice with different bindings leaves the first binding active (current behavior).
4. **Visual assets:** Spec suggested `current-lifecycle.svg`, `proposed-lifecycle.svg`; these were not added. Consider adding for onboarding.

---

## CI Readiness

- **`pnpm build`:** Succeeds (per tasks).
- **`pnpm test:packages`:** Succeeds except `@prisma-next/integration-kysely` due to `prisma-next` CLI not found in `emit:check` — **pre-existing**, not introduced by this PR.
- **`pnpm test:integration`:** Passes (per tasks).
- **`pnpm lint:deps`:** Passes (per tasks).
