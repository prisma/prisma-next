# Codec Async Support — Single-Path Runtime

## Summary

Implement single-path async codec support: the public `Codec` interface exposes Promise-returning query-time methods, the runtime always awaits and dispatches per-cell concurrently via `Promise.all`, and the codec factory transparently lifts synchronous author functions. Build-time methods stay synchronous so `validateContract` and client construction remain sync. Codecs are portable across SQL and Mongo families. The synchronous fast path is preserved as a future, additive opt-in (`codecSync()` + predicates).

**Spec:** [spec.md](spec.md)

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Project owner | Drives execution across all milestones |
| Architectural reviewer | Codec subsystem owner | Approves the codec interface and factory shape |
| Affected | Mongo extension authors | Same `Codec` interface lands in `mongo-codec`; encode-side runtime pattern (`resolveValue` → `MongoAdapter.lower()` → `MongoRuntime.execute()`) becomes async |
| Affected | ORM client consumers | Read/write type surfaces collapse to (or stay as) a single field type-map; rows continue to expose plain `T` for codec-decoded fields |

## Execution shape

Single branch (`feat/codec-async-single-path`), milestone-by-milestone with internal review/refine cycles between milestones. No stacked PRs. PR opening is deferred until implementation is complete (per project owner's direction).

## Milestones

### Milestone 1: Codec interface + factory

Establishes the public `Codec` shape and the `codec()` factory. Demonstrable via interface and factory unit tests covering both sync and async author forms.

**Tasks:**

- [ ] Write tests for the public `Codec` interface shape: `encode` / `decode` required and Promise-returning, `encodeJson` / `decodeJson` required and synchronous, `renderOutputType` optional and synchronous, no `runtime` / `kind` / `TRuntime` discriminators.
- [ ] Write tests for `codec()` factory: accepts sync `encode` / `decode`, accepts async `encode` / `decode`, accepts mixed (sync `encode`, async `decode` and vice versa), installs identity default when `encode` is omitted, passes `encodeJson` / `decodeJson` / `renderOutputType` through unchanged.
- [ ] Update [`packages/1-framework/1-core/framework-components/src/codec-types.ts`](../../packages/1-framework/1-core/framework-components/src/codec-types.ts): `Codec<Id, Traits, Wire, Input, Output>` with Promise-returning query-time methods, synchronous build-time methods, no async marker.
- [ ] Update [`packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts`](../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts): export the `codec()` factory; accept sync-or-async author functions; lift sync via `async (x) => fn(x)`; install identity default when `encode` omitted.
- [ ] Run interface/factory tests; iterate until green.
- [ ] Internal review/refine gate: confirm M1 interface + factory shape with the project owner before starting M2.

### Milestone 2: SQL runtime (always-await, concurrent dispatch)

The SQL runtime adopts a single async path per direction. Demonstrable via a SQL runtime exercising async and sync codecs end-to-end, with per-row `Promise.all` dispatch and standard error envelopes.

**Tasks:**

- [ ] Write tests for `encodeParams`: concurrent dispatch via `Promise.all`, mixed sync/async parameter codecs, error envelope wrapping (`RUNTIME.ENCODE_FAILED` with `{ label, codec, paramIndex }` and `cause`).
- [ ] Write tests for `decodeRow` / `decodeField`: concurrent dispatch via `Promise.all`, JSON-Schema validation against resolved values, error envelope wrapping (`RUNTIME.DECODE_FAILED` with `{ table, column, codec }` and `cause`), single-armed `decodeField` (no per-codec branch).
- [ ] Update [`packages/2-sql/5-runtime/src/codecs/encoding.ts`](../../packages/2-sql/5-runtime/src/codecs/encoding.ts): `encodeParams` async with `Promise.all`; `encodeParam` always awaits; standard envelope on failure.
- [ ] Update [`packages/2-sql/5-runtime/src/codecs/decoding.ts`](../../packages/2-sql/5-runtime/src/codecs/decoding.ts): `decodeRow` async with per-cell `Promise.all`; single-armed `decodeField` (codec → await → JSON-Schema validate → return plain value); standard envelope on failure.
- [ ] Verify [`packages/2-sql/5-runtime/src/codecs/json-schema-validation.ts`](../../packages/2-sql/5-runtime/src/codecs/json-schema-validation.ts) operates on resolved values; no shape changes expected, but confirm `validateJsonValue` is called after `await`.
- [ ] Update [`packages/2-sql/5-runtime/src/sql-runtime.ts`](../../packages/2-sql/5-runtime/src/sql-runtime.ts): one async path per direction; remove any plan-walker / `WeakMap` cache / `instanceof Promise` defensive guards (none should exist on `main`, but verify).
- [ ] Add regression test: `validateContract` stays synchronous (typed assertion + runtime check that no `await` is required).
- [ ] Add regression test: `postgres({...})` client construction stays synchronous.
- [ ] Run SQL runtime tests; iterate until green.
- [ ] Internal review/refine gate: confirm M2 runtime shape with the project owner before starting M3.

### Milestone 3: ORM client types and dispatch

Collapses read/write field type-maps to a single shared map; ORM dispatch awaits uniformly per row. Demonstrable via end-to-end ORM tests where async-codec columns surface plain `T` on both reads and writes.

**Tasks:**

- [ ] Write type tests for `DefaultModelRow` / `InferRootRow` with mixed sync/async codec columns: row fields are plain `T` (not `Promise<T>` or `T | Promise<T>`), in both `.first()` and streaming (`for await`) paths.
- [ ] Write type tests for write surfaces (`MutationUpdateInput`, `CreateInput`, `UniqueConstraintCriterion`, `ShorthandWhereFilter`, `DefaultModelInputRow`): inputs are plain `T`.
- [ ] Update [`packages/3-extensions/sql-orm-client/src/types.ts`](../../packages/3-extensions/sql-orm-client/src/types.ts): one field type-map shared by read and write surfaces; remove any read/write split for codec output types (none should exist on `main`, but verify against the spec — the constraint is "do not introduce a split").
- [ ] Update [`packages/3-extensions/sql-orm-client/src/collection-dispatch.ts`](../../packages/3-extensions/sql-orm-client/src/collection-dispatch.ts): per-row decoding awaits uniformly; row yields plain values to consumers.
- [ ] Add E2E test: query roundtrip with an async codec column exposes plain values on the resulting row, both via `.first()` and via `for await` streaming.
- [ ] Add E2E test: write surface accepts plain `T` for an async-codec column; encode runs through the runtime's async path.
- [ ] Run ORM client tests; iterate until green.
- [ ] Internal review/refine gate: confirm M3 client surface with the project owner before starting M4.

### Milestone 4: Cross-family parity (Mongo)

The Mongo `Codec` interface, factory, and encode-side runtime invocation pattern match SQL's. Demonstrable via a cross-family test that imports a single codec module and exercises it against both runtimes, plus a reshape of `resolveValue` / `MongoAdapter.lower()` / `MongoRuntime.execute()` to the always-await pattern.

**Scope note:** Mongo's runtime does not currently decode rows. The decode-side runtime reshape is therefore not part of this milestone (it would be inventing Mongo row decoding, orthogonal to async codecs). The encode side is fully reshaped.

**Tasks:**

- [ ] Write a cross-family test: a single `codec({...})` value is imported into both a SQL runtime fixture and a Mongo runtime fixture; encoding (and, for the SQL fixture, decoding) produces identical results for matching wire inputs.
- [ ] Update [`packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts`](../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts): adopt the unified `Codec` interface (re-export from `framework-components` or align the local shape), adopt the same factory entry point (`mongoCodec` accepts sync-or-async `encode` / `decode`, lifts sync), ensure query-time methods on the constructed codec are Promise-returning.
- [ ] Update built-in Mongo codecs ([`packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/core/codecs.ts)) to use the unified factory; codec definitions stay sync (factory lifts).
- [ ] Write tests for `resolveValue`: async dispatch, concurrent encoding of multiple codec-encoded leaves via `Promise.all`, identity passthrough for non-`MongoParamRef` values.
- [ ] Update [`packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts): async; for object/array nodes, dispatch child resolutions concurrently via `Promise.all`; await `codec.encode(...)` when present.
- [ ] Update [`packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts): `MongoAdapterImpl.lower()` async; `#resolveDocument` async (`Promise.all` over entries).
- [ ] Update the `MongoAdapter` interface in [`packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts`](../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts) to make `lower()` async (`Promise<AnyMongoWireCommand>`).
- [ ] Update [`packages/2-mongo-family/7-runtime/src/mongo-runtime.ts`](../../packages/2-mongo-family/7-runtime/src/mongo-runtime.ts): `execute()` awaits `adapter.lower(plan)` before passing to the driver.
- [ ] Update existing test fixtures: [`resolve-value.test.ts`](../../packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts) and [`mongo-adapter.test.ts`](../../packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts) — `await` expectations.
- [ ] Add regression test: `validateContract` for Mongo contracts stays synchronous; client construction stays sync.
- [ ] Run Mongo + cross-family tests; iterate until green.
- [ ] Internal review/refine gate: confirm M4 cross-family parity with the project owner before starting M5.

### Milestone 5: Security tests, ADR, and close-out

Translates PR #375's security tests and fixtures to the new runtime; writes the ADR; closes the project.

**Tasks:**

- [ ] Translate envelope-redaction tests from PR #375 to the new SQL runtime; verify codec error messages route via `cause` and bounded `wirePreview` is enforced.
- [ ] Translate validator-message redaction tests from PR #375; verify the trigger fires when expected.
- [ ] Translate JSON-Schema failure shape tests from PR #375.
- [ ] Translate include-aggregate test patterns from PR #375.
- [ ] Add (or translate) the `seeded-secret-codec` fixture: realistic crypto path via async `encode` / `decode`; exercise end-to-end including envelope redaction on failure.
- [ ] Author the new ADR (e.g. *ADR 0NN — Single-Path Async Codec Runtime*) documenting: single-path query-time design; build-time vs. query-time seam; cross-family portability requirement (interface always; encode-side runtime pattern parity in this project); walk-back framing for the future sync fast path; explicit list of walk-back constraints to preserve.
- [ ] Add a "Superseded by" pointer at the top of [ADR 030](../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md) for the async-runtime parts the new ADR replaces.
- [ ] Update affected package READMEs (`framework-components`, `relational-core`, `sql-orm-client`, `mongo-codec`, `mongo-adapter`) where their public surface narrative changes.
- [ ] Verify all spec acceptance criteria are met; produce a brief verification note (paste-into-PR-description-friendly).
- [ ] Migrate the ADR (and any long-lived doc) into `docs/`.
- [ ] Strip repo-wide references to `projects/codec-async-single-path/**` (replace with canonical `docs/` links or remove).
- [ ] As part of the implementation PR (or a follow-up close-out PR): delete `projects/codec-async-single-path/`.

## Test Coverage

| Acceptance Criterion (from spec) | Test Type | Task / Milestone | Notes |
|---|---|---|---|
| `Codec` interface shape (encode/decode required & Promise-returning; encodeJson/decodeJson sync; renderOutputType optional sync) | Unit (type-level + runtime) | M1: codec interface tests | |
| No per-codec async marker, no `TRuntime` generic | Unit (type-level) | M1: codec interface tests | Negative type test using `expect-type` or equivalent |
| Single `codec()` factory; sync/async/mixed/omitted-`encode` | Unit | M1: factory tests | |
| Sync codec works through runtime; replacing with async also works | E2E | M2: SQL runtime tests + M3: ORM E2E | Drives the end-to-end value of the design |
| One encoding path, one decoding path; both async; concurrent via `Promise.all` | Unit | M2: encoding/decoding tests | Verify a single async function per direction |
| Rows yield plain field values | E2E + type-level | M3: ORM E2E + type tests | |
| `validateContract` stays synchronous | Unit (type-level + runtime) | M2: regression test | |
| `postgres({...})` stays synchronous | Unit (type-level + runtime) | M2: regression test | |
| `RUNTIME.ENCODE_FAILED` / `RUNTIME.DECODE_FAILED` envelope shape with `cause` | Unit | M2: error envelope tests | |
| ORM `DefaultModelRow` / `InferRootRow` plain `T` for codec fields | Unit (type-level) | M3: ORM type tests | |
| ORM write surfaces accept plain `T` | Unit (type-level) | M3: ORM type tests | |
| One field type-map shared by read/write surfaces | Unit (type-level) | M3: ORM type tests | Negative type test that no read-only `Promise<T>` form exists |
| Mongo `Codec` interface matches SQL's | Unit (type-level) | M4: cross-family parity test | |
| Single `codec({...})` exercised against both SQL and Mongo runtimes | Integration | M4: cross-family E2E | |
| `resolveValue` async, concurrent dispatch via `Promise.all` | Unit | M4: resolve-value tests | |
| `MongoAdapter.lower()` async, `MongoRuntime.execute()` awaits | Unit + integration | M4: adapter + runtime tests | |
| Async codec failure → standard envelope; original on `cause` | Unit + E2E | M2 + M5: redaction tests | |
| Validator-message redaction fires when triggered | Unit | M5: translated from #375 | |
| `seeded-secret-codec` fixture exists, exercises async crypto E2E | Integration | M5: translated from #375 | |
| JSON-Schema failure shape | Unit | M5: translated from #375 | |
| Include-aggregate redaction patterns | Integration | M5: translated from #375 | |
| ADR documents single-path design + seam + cross-family + walk-back | Manual review | M5: ADR | Verify in close-out review |
| Walk-back constraints not violated by this work | Manual review | M5: close-out checklist | Specifically the seven constraints listed in spec NFR #5 |

## Open Items

Resolved shaping decisions are recorded above (Execution shape, M4 scope note, M5 ADR tasks). The items below are deferred or out-of-scope and tracked here so they don't get lost.

- **Sync fast-path opt-in (`codecSync()` + predicates)** — out of scope; future additive PR when production workload makes it load-bearing. The ADR's walk-back framing should point at this as the concrete next step.
- **Mongo decode path** — out of scope; Mongo does not decode rows today, and adding one is a separate piece of work orthogonal to async codecs (projection-aware document walker, async dispatch, result-shape decisions).
- **Bun/JavaScriptCore async parity verification** — out of scope; structural design is unaffected. Tracked as a possible future measurement task if a Bun deployment shows a materially different cost ledger.
- **Redaction-trigger spelling** — independent of this design; tracked separately with the redaction policy.
- **`TInput` / `TOutput` separation in the public `Codec` interface** — the design doc proposes 5 generics (`Codec<Id, TTraits, TWire, TInput, TOutput = TInput>`) where `main` has 4 (`<Id, TTraits, TWire, TJs>`). The async-codec work itself does not require the split; if M1 implementation finds the split is non-trivial, it gets revisited as a project-level decision (split now vs. defer; spec stays aligned with the design doc by default).

## Close-out (required)

- [ ] Verify all acceptance criteria in [spec.md](spec.md).
- [ ] Migrate the ADR (and any long-lived doc) into `docs/`.
- [ ] Strip repo-wide references to `projects/codec-async-single-path/**` (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/codec-async-single-path/`.
