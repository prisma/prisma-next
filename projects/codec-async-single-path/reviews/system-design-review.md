# System design review — `codec-async-single-path` (project-spanning, m1 → m5)

> **Scope.** This review now reflects the full project lifecycle on `feat/codec-async-single-path`. Initial sections preserve the as-built snapshot at HEAD `47ce86a6f` (m1..m4 SATISFIED); the § M2 R1 / § M3 R1 / § M3 R2 / § M4 R1 / § M4 R2 deltas and the final § M5 R1 section reflect the project end-state at HEAD `5ac4a3de6`. Round verdicts: **m1 → SATISFIED**, **m2 → SATISFIED**, **m3 → SATISFIED**, **m4 → SATISFIED**, **m5 R1 → ANOTHER ROUND NEEDED** (four doc / test-comment-quality findings F5/F6/F7/F8; AC substance complete; m5 R2 expected to close on a single doc-only commit and an optional second commit on the T5.4 deferred-test artifact).

## Sources

- Project spec: [spec.md](../spec.md)
- Project plan: [plan.md](../plan.md)
- Code review log: [code-review.md](code-review.md)
- Upstream design conversation:
  - [wip/review-code/pr-375/code-review-response.md](../../../wip/review-code/pr-375/code-review-response.md) — the rejecting review of PR #375 that argued for a different shape
  - [wip/review-code/pr-375/alternative-design.md](../../../wip/review-code/pr-375/alternative-design.md) — the single-path design this project implements
- Existing ADR (to be superseded for the async-runtime parts at m5): [docs/architecture docs/adrs/ADR 030 - Result decoding & codecs registry.md](../../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md)
- m1 source-touching commits: `978c4a57a`, `97c50079e`, `3a1e48a60`, `adafda3a1`

## 1. Problem and intent

The codec runtime today is purely synchronous: every codec method runs on the call stack of the query that invoked it, and rows are assembled out of plain values. A small but real class of codecs needs asynchronous work — KMS-resolved encryption keys, externally-resolved secrets, deferred reference lookups, secret rotation. These are minority cases, but concrete enough that the runtime needs to accommodate them.

[PR #375](https://github.com/prisma/prisma-next/pull/375) attempted to add async support via a per-codec opt-in: a `runtime` flag on the public `Codec` interface, a `TRuntime` generic, conditional return types on `encode` / `decode`, a dual-path SQL runtime, and a read/write type-map split in the ORM client. The architectural review ([code-review-response.md](../../../wip/review-code/pr-375/code-review-response.md), [alternative-design.md](../../../wip/review-code/pr-375/alternative-design.md)) rejected that direction in favor of a single-path design that:

- Localizes the cost of supporting both sync and async codecs to **one place** (the runtime's two codec invocation loops), not the public interface, the type system, or consumer-facing types.
- Lands cleanly on the structural seam between **query-time** (per-row, IO-relevant) and **build-time** (per-contract-load, sync) methods.
- Preserves a **two-way door** to a synchronous fast path as a non-breaking, additive opt-in (`codecSync()` + predicates) when sustained-throughput workloads require it.

This project (`codec-async-single-path`) implements that single-path design end-to-end on a fresh branch off `main`. m1 establishes the public `Codec` shape and the `codec()` factory; later milestones reshape the SQL runtime (m2), ORM client (m3), Mongo family (m4), and translate security/ADR work (m5).

## 2. New guarantees / invariants introduced at m1

m1 introduces five structural invariants, all on the codec shape itself; runtime, ORM, and Mongo invariants land in m2–m4.

### 2.1 Public `Codec.encode` / `Codec.decode` are Promise-returning at the boundary

Both methods are required and typed `(value) => Promise<T>` on the public `Codec` interface. The runtime sees one shape; authors may write either sync or async functions and the factory normalizes them. This is the central design choice: the cost of bridging sync and async lives in the runtime invocation loops (m2), not threaded through the type system at every call site.

### 2.2 Public `Codec.encodeJson` / `Codec.decodeJson` / `Codec.renderOutputType` remain synchronous

This is a *deliberate non-change*: the build-time vs. query-time seam pre-dates this project, and the design lands the async question on it cleanly. `validateContract` walks the contract artifact via `decodeJson`, and `postgres({...})` and equivalents call `validateContract` during construction; keeping those methods synchronous keeps the entire contract-load path structurally synchronous, regardless of how many codecs in the registry have async query-time methods. m1 enforces this at the type level via three "synchronous" type tests in `codec-types.types.test-d.ts`; the literal `validateContract` / `postgres({...})` regression tests are deferred to m2 (T2.7 / T2.8) where the SQL runtime typechecks end-to-end.

### 2.3 One factory `codec({...})`; no `codecSync` / `codecAsync` / runtime discriminator

The `codec()` factory in `relational-core` accepts sync, async, or mixed `encode` / `decode` author functions and lifts sync ones via `async (x) => fn(x)`. There is no parallel `codecSync` factory (deferred to a future, additive PR — spec § Non-goals); no `runtime: 'sync' | 'async'` field on the public interface; no `kind` discriminator; no `TRuntime` generic; no exported `isSyncEncoder` / `isSyncDecoder` predicates. These seven walk-back constraints (NFR #5 in [spec.md](../spec.md)) are what preserves the two-way door — landing any of them today would lock the design into the public surface and prevent the additive sync fast path described in [alternative-design.md § Why we trust this design](../../../wip/review-code/pr-375/alternative-design.md#why-we-trust-this-design).

### 2.4 `TInput` / `TOutput` generic split with `TOutput = TInput` default

The pre-m1 interface had four generics: `Codec<Id, TTraits, TWire, TJs>`. m1 ships five: `Codec<Id, TTraits, TWire, TInput, TOutput = TInput>`. The default preserves all 4-generic call sites (a pre-m1 `Codec<Id, Traits, Wire, Js>` resolves to `Codec<Id, Traits, Wire, Js, Js>` with identical method signatures); explicit 5-generic call sites can express the asymmetric case (e.g., a codec that decodes to a richer type than it accepts on input, like a Date decoder that accepts strings on the way in but returns Date on the way out). This was an *open* item in the plan ("split now vs. defer"); it was applied at m1 because deferring would force a larger reshape later when m4 codecs benefit from the asymmetry.

### 2.5 `encode` is optional in the spec but always present on the constructed `Codec`

When a codec author omits `encode`, the factory installs an identity passthrough — the codec is declaring "the input value is already the wire value", so `TInput` and `TWire` are interchangeable for that codec. The constructed `Codec` always has both `encode` and `decode` so the runtime never has to check for `encode`'s presence. (The previous shape had `encode?` optional on the interface itself; m1 makes it required at the boundary while keeping the spec ergonomics.)

## 3. Subsystem fit

m1 lives at two layers, by design:

- **`packages/1-framework/1-core/framework-components`** — the target-agnostic public `Codec` interface. This is the shape every family (SQL, Mongo, future Document targets) must align with. It carries no SQL- or Mongo-specific fields.
- **`packages/2-sql/4-lanes/relational-core`** — the SQL family's local `Codec` extension (adds `meta`, `paramsSchema`, `init`) and the `codec()` factory. Lives in the lane layer (not core) because the factory is SQL-specific machinery: it composes a SQL `Codec` whose framework-agnostic methods are inherited from the core base type, plus the SQL-specific fields on top.

m4 will validate cross-family parity by aligning `mongo-codec`'s `Codec` interface to the same shape and making `mongoCodec(...)` accept the same sync-or-async author functions. The plan calls for either re-exporting the framework `Codec` directly or aligning the local Mongo shape; either preserves the spec's "single `codec({...})` value structurally usable in both SQL and Mongo runtimes" requirement.

The build-time vs. query-time seam keeps the contract pipeline (`schema.psl` → contract emitter → `contract.json` + `contract.d.ts` → `validateContract` → `postgres({...})` → consumer DSL) structurally synchronous: nothing on that pipeline calls `encode` / `decode`, so async codec methods never propagate back into contract loading or client construction. The async affordance is confined to the per-row hot paths in m2.

## 4. Boundary correctness

- **Layering.** `framework-components` (core, layer 1) declares the base `Codec` shape; `relational-core` (lane, layer 4) extends it for SQL and exports the factory. Imports flow downstream only; the framework component does not depend on the lane. `pnpm lint:deps` PASS workspace-wide at HEAD `adafda3a1` (606 modules / 1198 deps cruised, 0 violations).
- **Domain.** No SQL- or Mongo-specific assumptions leak into the framework `Codec` shape. The interface is target-agnostic, so the cross-family m4 alignment is a structural identity check, not a translation.
- **Determinism.** The `codec()` factory returns frozen-shape codec objects; no shared mutable state. `Promise.all` resumption (claimed by the design but exercised in m2) is deterministic in V8/Node-compatible engines per the [V8 fast-async claim](https://v8.dev/blog/fast-async).
- **No public re-exports for backwards compatibility.** Per `AGENTS.md` § Golden Rules, m1 introduces no shim or alias — the previous 4-generic call sites continue to work via the `TOutput = TInput` default rather than via a separate export.

## 5. ADRs

m1 does not modify any ADR. The plan schedules the new ADR (e.g. *ADR 0NN — Single-Path Async Codec Runtime*) and the [ADR 030](../../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md) "Superseded by" pointer for **m5 (T5.6 / T5.7)**. The m5 ADR will document the single-path query-time design, the build-time vs. query-time seam, the cross-family portability requirement, and the walk-back framing for the future sync fast path.

[ADR 030 § Decoding pipeline § Streaming and cursors](../../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md) currently asserts "Codecs must be synchronous and non-blocking." That claim is the headline thing being superseded: at m5 the new ADR will replace it with the single-path async statement, and ADR 030 will gain a "Superseded by" pointer for the relevant sections (decoding pipeline, registry codec shape). The supersede pointer is a *delta on top of* ADR 030, not a wholesale replacement — most of ADR 030 (precedence rules, registry model, error mapping, observability) is unaffected by the async question.

## 6. Test strategy adequacy at the architectural level

### 6.1 What m1 actually proves

- **Interface shape (AC-CF1, AC-CF2):** Eight type-level assertions in [codec-types.types.test-d.ts](../../../packages/1-framework/1-core/framework-components/test/codec-types.types.test-d.ts) pin `encode` / `decode` as required and Promise-returning, `encodeJson` / `decodeJson` as required and synchronous, `renderOutputType` as optional and synchronous. The full keyset of `Codec` is asserted via `expectTypeOf<keyof Codec>().toEqualTypeOf<…>()` against an explicit list of 8 expected keys, which directly proves "no `runtime` / `kind` field". The "no `TRuntime` generic" half of AC-CF2 is verified by source inspection of the 5-generic interface declaration. Two new tests pin the `TInput` / `TOutput` asymmetric case and the 4-generic-default case.
- **Factory behavior (AC-CF3):** Ten runtime tests in [codec-factory.test.ts](../../../packages/2-sql/4-lanes/relational-core/test/ast/codec-factory.test.ts) exercise sync `encode`, sync `decode`, async `encode`, async `decode`, mixed sync/async, identity-default `encode`, sync pass-through of `encodeJson` / `decodeJson`, optional `renderOutputType` present, and absence of `renderOutputType` when not provided. Six type-level tests in [codec-factory.types.test-d.ts](../../../packages/2-sql/4-lanes/relational-core/test/ast/codec-factory.types.test-d.ts) mirror the runtime cases at the type level, plus assert build-time methods do not extend `Promise<unknown>`.
- **Build-time sync (AC-RT3, AC-RT4 — type-level only at m1):** Covered structurally by the "encodeJson / decodeJson required and synchronous" and "renderOutputType optional and synchronous" type tests in `codec-types.types.test-d.ts`. Because `validateContract` and `postgres({...})` consume only build-time methods, keeping those synchronous on the public interface is structurally sufficient at m1. The literal regression tests live at m2 where the SQL runtime typechecks end-to-end.
- **Downstream test-fixture compatibility (F2 closure):** Inline `Codec`-shaped object literals in `framework-components/test/control-stack.test.ts`, `sql-contract-ts` (×2), `cli`, and `integration-tests` were updated to satisfy the new interface (`encode: async (v) => v`, `decode: async (v) => v`). The audit was completed across the workspace at commit `adafda3a1`; remaining sync-shaped `Codec` literals in the workspace are either factory inputs (which the factory accepts), `as unknown as Codec` cast fixtures (typecheck-bypassed), or m2-residual consumer-side casts in `adapter-postgres/test/codecs.test.ts` (planned reshape).

### 6.2 What m1 cannot yet prove (deferred to later milestones)

- **E2E sync codec → async codec swap (AC-CF4).** The spec asserts "a codec author can write `codec({ ..., encode: (v) => v, decode: (w) => w })` with sync functions and have it work end-to-end through the runtime; replacing the query-time functions with `async` versions also works without further changes." The runtime path required to verify this lands at m2/m3.
- **Concurrent dispatch via `Promise.all` (AC-RT1, AC-RT2).** The factory at m1 produces Promise-shaped methods; the runtime that calls `Promise.all` over those methods is m2 work.
- **Cross-family parity (AC-CX1–AC-CX5).** The framework `Codec` is structurally agnostic at m1, but Mongo's local `Codec` shape (`mongo-codec/src/codecs.ts`) still uses the pre-m1 sync surface. m4 aligns it.
- **Standard error envelopes (AC-RT5, AC-RT6, AC-SE1–AC-SE4).** Runtime-level concern; m2 + m5.

These deferrals are not gaps in m1's evidence — they are correctly scheduled to milestones where the relevant code lands. The "progressive-green" validation gate convention in [plan.md § Validation gate convention](../plan.md) explicitly enumerates them as expected residual.

### 6.3 Test-strategy concern flagged for future review

R2's m1 round notes flagged a *typecheck-clean surprise* at HEAD: `pnpm --filter @prisma-next/sql-runtime typecheck` and `pnpm --filter @prisma-next/sql-orm-client typecheck` both exit 0, which the plan's expected-residual classification did not predict. This is informational, not a blocker — but it suggests that part of m2 / m3's planned reshape may already be implicit (e.g., consumer call sites already routing through `unknown` / structural casts that smooth over the sync→Promise change), or that those packages don't actually call `codec.encode` / `codec.decode` directly. The m2 / m3 reviewer should confirm whether this means the reshape scope can be narrowed or whether the typecheck-clean is masking a real failure (e.g., a `tsconfig` boundary issue). Architecturally not a problem, but worth understanding.

## 7. Risks at m1

- **Promise allocation pressure across all codec calls (NFR § Performance assumptions).** Once m2 lands, every codec invocation allocates one Promise per cell (lifted-sync codecs) or one Promise per cell + body work (genuinely async codecs). For a query returning N rows × M cells, that's N × M Promise allocations. Microtask scheduling is O(1) per row via `Promise.all` resumption batching, so latency is one tick per row plus codec body work. The cost trajectory at sustained high throughput is allocation pressure, not latency. The walk-back path (`codecSync()` + predicates as a future additive opt-in) is documented in [alternative-design.md § Why we trust this design](../../../wip/review-code/pr-375/alternative-design.md#why-we-trust-this-design). m1 itself does not introduce this risk on the runtime — it only sets the stage by making `encode` / `decode` Promise-returning at the type level — but the strategic risk lives with the project as a whole.
- **No security or migration concerns at m1.** No data-handling code lives at this layer; no public-facing surface that isn't already exercised. The error-redaction policy work translates from PR #375 at m5. Existing 4-generic call sites are preserved by the `TOutput = TInput` default; existing test-fixture object literals were updated mechanically (commits `97c50079e`, `3a1e48a60`, `adafda3a1`).
- **Process risk noted but not a code finding.** The R2 round of `code-review.md` records a procedural anomaly: two F2-fix commits landed before the R2 implementer was delegated. The user retained the commits (substance correct, scoped, on-recipe) but the protocol observation is on record for future rounds — under the orchestrator skill's read/write matrix, the reviewer is read-only on code and tests. The constraint is reaffirmed for m2+.

## 8. Open questions for m2 review

These are not findings — they are forward-looking items the m2 reviewer should keep in scope:

1. **m2/m3 reshape scope re-estimation.** Per § 6.3, confirm whether `sql-runtime` / `sql-orm-client` typecheck-clean at m1 means part of m2/m3's planned work is already implicit, or whether it's a false positive masking a real failure.
2. **Plan-walker / `WeakMap` cache / `instanceof Promise` defensive guards.** The single-path design explicitly excludes these from the runtime (alternative-design.md § Where the cost lives). Verify they aren't introduced when `encodeParams` / `decodeRow` are reshaped.
3. **The `as unknown as TWire | Promise<TWire>` cast in the factory's identity-default `encode`** ([packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts (L221–L222)](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts:221-222)). The cast is the type-system expression of "input value is the wire value" when `encode` is omitted; semantics match the design doc but the cast lacks an inline comment per `AGENTS.md` § Typesafety rules. Worth a "should-fix" review pass when the factory is re-touched (m4 cross-family alignment is a natural moment); not flagged at m1 because it follows the pattern documented in [alternative-design.md § The factory](../../../wip/review-code/pr-375/alternative-design.md#the-factory).

---

## M2 R1 — runtime async path

> **Scope.** This section reflects HEAD `4d7fc1261`, which corresponds to **m2 SATISFIED** in [code-review.md § m2 — Round 1](code-review.md). m2 commits under review: `a83ccb200` (failing tests), `62a565d0c` (implementation), `4d7fc1261` (adapter test consumer reshape). Orchestrator bookkeeping commit `e47a09077` (F1 → m4 T4.2 sub-task) is context-only. The original M1 sections above are preserved verbatim; M2 deltas are appended here.

### M2.1 New guarantees / invariants introduced at m2

m2 lands the runtime portion of the single-path design. Five new structural invariants:

#### M2.1.1 SQL runtime executes a single async iterator with `await` at both boundaries

`sql-runtime.ts`'s `executeAgainstQueryable` wraps the queryable in a single async generator that (a) `const encodedParams = await encodeParams(...)` once before driver dispatch, and (b) `for await (const rawRow of coreIterator) { const decodedRow = await decodeRow(...); yield decodedRow as Row; }` per row. The runtime sees one shape: a Promise-returning `codec.encode` / `codec.decode` boundary, with all sync-vs-async branching pushed inside the m1 codec factory's lift. There is no plan-walker, no `WeakMap` cache, no `instanceof Promise` defensive guard — verified by `rg 'instanceof Promise|WeakMap|plan-walker' packages/2-sql/5-runtime/src` returning zero matches. T2.6 was preventative.

#### M2.1.2 Concurrent dispatch via `Promise.all` at exactly two sites

[encoding.ts (L78–L100)](../../../packages/2-sql/5-runtime/src/codecs/encoding.ts:78-100) builds a `tasks: Promise<unknown>[]` array indexed by parameter ordinal, then awaits a single `Promise.all(tasks)` and freezes the result. [decoding.ts (L210–L277)](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts:210-277) builds a `tasks` array indexed by alias position (one per cell, with `Promise.resolve(undefined)` placeholders for include-aggregate slots), awaits `Promise.all(tasks)`, then synchronously slots include-aggregates into the `undefined` positions before assembling the row. **Failure semantics: `Promise.all` fail-fast** — the first rejected task surfaces as the error envelope; remaining tasks resolve but their outputs are discarded. This matches the prior single-loop semantics where a thrown decode short-circuited before later cells ran.

#### M2.1.3 Single-armed `decodeField` (no sync-vs-async branching)

[decoding.ts (L164–L201)](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts:164-201) introduces a new local async function `decodeField(wireValue, alias, ref, codec, jsonValidators)` that is the sole per-cell decode path: `await codec.decode(wireValue) → optional sync validateJsonValue against the resolved value → return plain decoded value`. The "single-armed: same path for sync and async codec authors" test in [codec-async.test.ts (L479–L523)](../../../packages/2-sql/5-runtime/test/codec-async.test.ts:479-523) exercises a sync-authored codec and an async-authored codec through the same `decodeField` body and asserts identical outputs. The function never branches on `runtime` flag, never inspects `instanceof Promise`, never calls a sync fast path. This is the central architectural promise of the project, on disk.

#### M2.1.4 Standard runtime error envelopes with `cause` chaining

`RUNTIME.ENCODE_FAILED` (encode side) and `RUNTIME.DECODE_FAILED` (decode side) now wrap codec failures with structured detail and the original error preserved on `cause`:

- **Encode:** `{ label, codec, paramIndex }` where `label = paramDescriptor.name ?? '$<paramIndex+1>'` and `paramIndex` is zero-based. Implemented by `wrapEncodeFailure` in [encoding.ts (L23–L38)](../../../packages/2-sql/5-runtime/src/codecs/encoding.ts:23-38).
- **Decode:** `{ table, column, codec }` when projection mapping or plan refs resolve a `ColumnRef` for the alias; `{ alias, codec }` fallback when neither is available. Implemented by `wrapDecodeFailure` in [decoding.ts (L98–L118)](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts:98-118).

`RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` (the existing sync envelope from `validateJsonValue`) is preserved verbatim and not re-wrapped — `wrapDecodeFailure` checks the thrown error's `code` and re-raises the original envelope when it matches a known JSON-Schema validation code.

#### M2.1.5 Build-time vs. query-time seam preserved at the literal level

m1 proved structural sync at the type level via `codec-types.types.test-d.ts` (`encodeJson` / `decodeJson` / `renderOutputType` typed as sync). m2 closes the loop at the literal regression level: [validate.test.ts (L856–L881)](../../../packages/2-sql/1-core/contract/test/validate.test.ts:856-881) and [postgres.test.ts (L112–L124)](../../../packages/3-extensions/postgres/test/postgres.test.ts:112-124) each contain a `describe('synchronous return (regression)')` block with one type-level subtest (assignment to a non-Promise-typed variable) and one runtime subtest (`expect(typeof (result as { then?: unknown }).then).toBe('undefined')`). The contract pipeline's structural synchrony is now defended at the literal call-site level.

### M2.2 Subsystem fit (delta)

m2 lands changes at four layers:

- **`packages/2-sql/5-runtime`** (lane runtime, layer 5): the central reshape. `encoding.ts`, `decoding.ts`, `sql-runtime.ts` updated to the async path; new test file `codec-async.test.ts` (12 tests covering T2.1 + T2.2); existing `json-schema-validation.test.ts` re-awaited at call sites.
- **`packages/2-sql/1-core/contract`** (core, layer 2): `validate.test.ts` adds the synchronous-return regression suite (T2.7).
- **`packages/3-extensions/postgres`** (extension, layer 6): `postgres.test.ts` adds the synchronous-return regression suite (T2.8).
- **`packages/3-targets/6-adapters/postgres` and `.../sqlite`** (adapters, layer 6): inline `Codec`-shaped test casts narrowed from `{ encode: (v) => string }` to `{ encode: (v) => Promise<string> }`; call sites prefixed with `await`. No production code changes.

`pnpm lint:deps` PASS workspace-wide (606 modules / 1198 deps cruised, 0 violations) — the runtime reshape is contained within the existing layering.

### M2.3 Boundary correctness (delta)

- **Envelope shapes match AC-RT5 and AC-RT6.** Both envelopes carry `cause` (chains the original codec error per the AC) plus structured details (`label, codec, paramIndex` for encode; `table, column, codec` for decode). The decode envelope's fallback to `{ alias, codec }` when `ColumnRef` cannot be resolved is graceful runtime degradation — it preserves the codec id (which is the most important diagnostic for "which codec misbehaved?") and the alias (which the application-level caller can correlate against the projection it sent). The AC's strict `{ table, column, codec }` requirement is met whenever the plan carries the metadata to populate it; the fallback is for non-DSL plans or hand-rolled execution plans where projection mapping is absent. Documented in this SDR rather than the AC scoreboard because the design choice is intentional, not a deviation.
- **`Promise.all` failure ordering is observably deterministic.** In `decodeRow`, codec dispatch failures (rejections from `decodeField` tasks) surface before include-aggregate decoding runs (which is synchronous and post-gather). The prior synchronous loop had identical semantics: a thrown decode short-circuited the loop before later cells ran. Include-aggregates therefore continue to be a strict success-path operation; they never see partial codec failures.
- **`fallbackColumnRefIndex` build condition is bounded and necessary.** The condition was broadened from "build when validators are present" to "build when projection alias-to-ref mapping is unavailable, validator-independent". The change is required for AC-RT6 (envelope must carry `{ table, column }` regardless of validator presence). The validator-present hot path (DSL plans with select projection) is unchanged: when projection mapping is present, `!projection || Array.isArray(projection)` is `false` and no index is built. The new path that newly allocates an index is "projection mapping unavailable, validators absent" — a rare edge case for non-DSL plans, with cost dominated by per-row codec dispatch.

### M2.4 ADRs (delta)

m2 does not modify any ADR. The new ADR documenting the single-path query-time design is still scheduled for **m5 (T5.6 / T5.7)**, with a "Superseded by" pointer added to [ADR 030](../../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md)'s "Codecs must be synchronous and non-blocking" claim. The m5 ADR will document, in addition to the m1 design points, the m2 runtime invariants:
- Two `Promise.all` dispatch sites (encode params; decode row cells), exactly.
- Single-armed `decodeField` and the explicit prohibition on plan-walker / `WeakMap` / `instanceof Promise` guards.
- The build-time / query-time seam at the literal regression level (`validateContract` and `postgres({...})` synchrony).
- The runtime envelope contract (`RUNTIME.ENCODE_FAILED` / `RUNTIME.DECODE_FAILED` / preserved `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED`), with `cause` and structured details.
- The graceful fallback for `RUNTIME.DECODE_FAILED` when `ColumnRef` resolution is not possible — `{ alias, codec }` instead of `{ table, column, codec }`.

No ADR-shape decisions are *new* at m2 (every architectural point is consistent with the m1 SDR and the [alternative-design.md](../../../wip/review-code/pr-375/alternative-design.md) that motivated the project). The m5 ADR will collapse the m1 and m2 sections of this SDR into a durable architectural record.

### M2.5 Test strategy adequacy (delta)

#### M2.5.1 What m2 actually proves

- **Concurrent dispatch + await guarantees + single-armed decode path (AC-RT1, AC-RT2, AC-CF4 runtime portion).** [codec-async.test.ts](../../../packages/2-sql/5-runtime/test/codec-async.test.ts) provides 12 tests across two suites: (a) `encodeParams` — concurrent dispatch via Promise.all (start/resolve ordering pinned), no Promise leaks (post-encode cell shape inspection), failure envelope shape (label, codec, paramIndex, cause), label fallback to `param[<i>]`; (b) `decodeRow / decodeField` — concurrent per-cell dispatch (start/resolve ordering pinned), no Promise leaks at the row level, JSON-Schema validation against the resolved decoded value, single-armed parity for sync vs async authors, failure envelope shape with both projection-mapping and `fallbackColumnRefIndex` paths. Coverage is appropriate for the AC.
- **Build-time sync regression (AC-RT3, AC-RT4).** [validate.test.ts](../../../packages/2-sql/1-core/contract/test/validate.test.ts) and [postgres.test.ts](../../../packages/3-extensions/postgres/test/postgres.test.ts) each add a `synchronous return (regression)` describe block with type-level + runtime subtests. Both pass at HEAD.
- **JSON-Schema validation against resolved value (AC-RT7).** [codec-async.test.ts](../../../packages/2-sql/5-runtime/test/codec-async.test.ts) "runs JSON-Schema validation against the resolved (awaited) decoded value" pins the call-site sequence (`await codec.decode(...)` precedes `validateJsonValue(...)`).
- **Error envelope shapes (AC-RT5, AC-RT6).** Failure envelope tests assert on the literal `code`, `details`, and `cause` shape, including the `details.label` / `details.column` fallback paths. The "preserved JSON_SCHEMA_VALIDATION_FAILED code" path is exercised implicitly by the existing `json-schema-validation.test.ts` suite re-awaited at HEAD.

#### M2.5.2 What m2 cannot yet prove (deferred)

- **ORM-level `.first()` / `.all()` / `for await` row-shape type tests (AC-RT2 ORM portion).** The runtime portion is proven at m2 (rows yielded by `executeAgainstQueryable` have plain field values); the ORM lane's row-shape type assertions are scheduled for m3 (T3.1).
- **AC-CF4 ORM E2E swap.** "Sync codec → async codec replacement at the ORM call site" is m3 work (T3.5 / T3.6); m2 proves the runtime half of the AC.
- **Cross-family parity (AC-CX1–AC-CX5).** m4 work; Mongo's local `Codec` shape is unchanged at m2.

#### M2.5.3 Test-strategy concern flagged for forward review

`sql-orm-client` continues to typecheck and test green at m2. The plan's "expected residual" classification at m1 had this package failing on the assumption that consumer-side calls to `codec.encode` / `codec.decode` would surface `Promise<TWire>` mismatches. **Updated finding at m2:** Reviewer ran `rg 'codec\.(encode|decode)\b' packages/3-extensions/sql-orm-client/src` — zero matches. The package consumes results through `sql-runtime`'s now-await-correct async iterator, so the Promise-returning `Codec` interface never reaches `sql-orm-client/src` directly. This explains the m1 R2 typecheck-clean surprise and means a meaningful portion of m3's planned T3.5 / T3.6 work may already be implicitly satisfied by m2's await-at-the-boundary reshape. m3's residual scope likely reduces to (a) `extension-pgvector` consumer reshape (still failing typecheck per plan), (b) m3-T3.1's ORM-level type-test assertions, and (c) any consumer code in the ORM lane that *constructs* codec literals as opposed to *calling* codec methods. **Forward to m3 reviewer + orchestrator:** confirm and re-scope m3 before delegation.

### M2.6 Risks at m2

- **Promise allocation pressure now realized.** The strategic risk noted in M1 § 7 is now on disk: every codec dispatch allocates one Promise per cell. For a query returning N rows × M cells, that's N × M Promise allocations; sustained-throughput workloads will see allocation pressure, not latency (microtask scheduling is one tick per row via `Promise.all` resumption batching). The walk-back path (`codecSync()` + predicates as a future additive opt-in) remains preserved by the design; no walk-back constraint was breached at m2 (the m1 walk-back inventory of [no marker / no variants / no predicates / no conditional return types / no `TRuntime` / no mis-framed author-surface docs / no async-dependent public guarantees] was re-checked by reviewer and remains intact).
- **`Promise.all` failure semantics are partial fail-fast.** If two cells have failing decoders, only the first rejected task's envelope is surfaced; the second's body still runs (cannot be cancelled in standard `Promise.all`) but its output is discarded. This is consistent with the prior synchronous loop's "throw on first failure" semantics from the user's point of view — the application sees one error envelope per row. Documented here so the m5 ADR can be explicit about it.
- **`fallbackColumnRefIndex` build condition broadening.** Triaged as bounded (M2.3 above). Risk is minimal: the worst case is one `Map<string, ColumnRef>` allocation per `decodeRow` call when projection mapping is unavailable, which is dominated by per-row codec dispatch costs. Accepted; no finding.
- **Include-aggregate placeholder pattern (`Promise.resolve(undefined)`).** Triaged as functionally equivalent to the prior sync branch (M2.3 above). Order-equivalent (deterministic post-gather slot assignment), failure-equivalent (include-aggregates never see partial codec failures), allocation cost is one resolved-Promise per include-aggregate per row (negligible in the typical case where include-aggregates are a minority of cells).

### M2.7 Open questions for m3 review

These are forward-looking items the m3 reviewer should keep in scope:

1. **Confirm m3 scope re-estimation against the `sql-orm-client` typecheck-clean observation.** Per § M2.5.3, a meaningful portion of T3.5 / T3.6 may already be implicit; verify with the implementer at the start of m3 R1 whether residual ORM lane reshape work is limited to consumer construction sites and `extension-pgvector`. The orchestrator may amend the plan before m3 begins.
2. **ORM-level `.first()` / `.all()` / `for await` type-test assertions (T3.1).** These verify AC-RT2's "no Promise leaks into user code" guarantee end-to-end through the ORM lane; expect them to pass without consumer reshape since the runtime already returns plain field values.
3. **The `as unknown as TWire | Promise<TWire>` cast in the factory's identity-default `encode`** (carried forward from M1 § 8.3). Still unaddressed at m2 (factory not touched). Continues to be a candidate for "should-fix" review when m4's T4.2 reshape touches the factory.
4. **Plan-walker / `WeakMap` cache / `instanceof Promise` defensive guards.** Verified absent at m2 (M2.1.1 above). m3 should re-check after ORM-level changes, particularly around the `executeAgainstQueryable` boundary and any new dispatch path the ORM lane introduces.

### M2.8 ADR-shape decisions made at m2 (none new; continuity check)

m2 introduces no new architectural decisions beyond what m1 prefigured. Every m2 invariant (M2.1.1 through M2.1.5) is consistent with the design captured in [alternative-design.md](../../../wip/review-code/pr-375/alternative-design.md) and the m1 SDR. The m5 ADR will document:
- The two-place runtime cost concentration (encodeParams; decodeRow);
- The runtime's structural symmetry with the build-time / query-time seam (encode/decode async at the boundary; encodeJson/decodeJson sync at the boundary; runtime composes them);
- The deferred sync fast path (preserved as a two-way door, not implemented at m2 or m5);
- The runtime envelope contract (RUNTIME.ENCODE_FAILED / RUNTIME.DECODE_FAILED / preserved RUNTIME.JSON_SCHEMA_VALIDATION_FAILED).

## M3 R1 — ORM client surface verification

> **Scope.** Reflects HEAD `41e01b5f3`. m3 R1 is **ANOTHER ROUND NEEDED** ([code-review.md § m3 — Round 1](code-review.md)) on the strength of one open should-fix finding (F3 — duplicate header doc comments in `collection-dispatch.ts`). The ORM-client substantive design picture is unchanged from the m2 prediction: m3 turned out to be a verification-only milestone.

### M3.1 New guarantees / invariants confirmed at m3

m3 introduces **no new structural invariants**. It instead **verifies** that the m1 + m2 design propagates the async-codec semantics through the ORM lane unchanged, and produces type-level + runtime evidence pinning that propagation in tests so future drift is caught at compile- or test-time.

#### M3.1.1 ORM-client read surfaces present plain `T` (verification of AC-OC1)

For every codec-decoded field on every read surface, the ORM client exposes `T` (or `T | null`), never `Promise<T>` or `T | Promise<T>`. This is *structurally* true at m2 already — `sql-runtime`'s async generator awaits `decodeRow` before yielding (M2.1.2 in this SDR), so by the time a row reaches `dispatchCollectionRows` the cells are plain. m3 adds 21 type-level assertions ([test/codec-async.types.test-d.ts](../../../packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts)) that pin the invariant on `DefaultModelRow`, `InferRootRow`, `Collection.first()`'s awaited row, the `Collection.all()` async iterator's iterated row, and `Collection.all().firstOrThrow()`'s awaited row. Each read-position carries an `IsPromiseLike<…> = false` negative assertion as a regression guard.

#### M3.1.2 ORM-client write surfaces accept plain `T` (verification of AC-OC2)

`CreateInput`, `MutationUpdateInput`, `UniqueConstraintCriterion`, and `ShorthandWhereFilter` all accept plain `T` for codec-backed field positions. The runtime's m2 `await encodeParams` boundary is solely responsible for lifting plain `T` → `Promise<TWire>` via the m1 factory's lift; consumers never see Promise-typed write fields. m3 adds 6 type-level assertions to pin this and 5 live-Postgres integration tests ([test/integration/codec-async.test.ts](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts)) that verify `create()` and `update()` with plain `T` actually persist the codec's wire format (`'[0.1,0.2,0.3]'` for `pg/vector@1`; `{ street, city, zip }` JSON for `pg/jsonb@1`).

#### M3.1.3 One field type-map shared by read and write surfaces (verification of AC-OC3)

The ORM client uses a single field type-map per model: [packages/3-extensions/sql-orm-client/src/types.ts (L426–L428)](../../../packages/3-extensions/sql-orm-client/src/types.ts:426-428) defines `DefaultModelRow<TContract, ModelName>` as `{ [K in keyof FieldsOf<…>]: FieldJsType<…> }`, and the four downstream write-surface derivations (`CreateInput` L776, `VariantCreateInput` L808, `NestedCreateInput`/`MutationCreateInput` L1027/L1044, `MutationUpdateInput` L1055) all `Pick`/`Partial` from `DefaultModelRow<TContract, ModelName>`. There is no `DefaultModelInputRow` (verified by `rg DefaultModelInputRow packages/` returning zero matches in `src/`). Two type-test equality assertions (`NonNullable<UserCreate['name']> === UserRow['name']`, `NonNullable<UserUpdate['name']> === UserRow['name']`) pin the invariant — any future drift introducing a parallel write-surface field map with `Promise<T>` would fail these assertions.

#### M3.1.4 ORM dispatch is codec-agnostic (verification of AC-RT2 ORM portion)

`dispatchCollectionRows` in [packages/3-extensions/sql-orm-client/src/collection-dispatch.ts](../../../packages/3-extensions/sql-orm-client/src/collection-dispatch.ts) does not call `codec.encode` or `codec.decode` directly (`rg 'codec\.(encode|decode)\b' packages/3-extensions/sql-orm-client/src` returns zero matches). The dispatch flow is `Collection.all() → dispatchCollectionRows → executeQueryPlan → runtime.execute → sql-runtime`'s async generator (which `await`s `decodeRow` once per yielded row before yielding plain rows). This is *structurally* the m2 design point; m3 confirms it on disk, adds a header doc comment to record the invariant in the file itself, and exercises the path under live Postgres in the integration test's `for await ... of posts.orderBy(...).all()` loop with per-row `expect(row.embedding).not.toBeInstanceOf(Promise)` assertions.

### M3.2 Subsystem fit at m3

#### M3.2.1 ORM lane consumes runtime's async iterator unchanged

The ORM client (`@prisma-next/sql-orm-client`) consumes `AsyncIterableResult<Row>` produced by `executeQueryPlan` → `runtime.execute`. Per-row decoding is owned by `sql-runtime`'s `executeAgainstQueryable` async generator (M2.1.2 in this SDR); the ORM lane is the *consumer side* of the decode-once-per-row contract. No per-codec dispatch lives in the ORM lane.

This is the structurally correct shape: **codec dispatch is concentrated in the runtime layer (M2.1.4: two `Promise.all` sites — `encodeParams`, `decodeRow`), not duplicated in higher-level lanes.** The plan's m1 R2 typecheck-clean observation about `sql-orm-client` (forwarded to m3 via M2.5.3 / M2.7.1) was a true signal: the ORM lane was already correctly positioned at m2, and m3's residual work was verification-only — type-level evidence that the ORM lane *exposes* the runtime guarantees as plain `T`, plus integration evidence that the round-trip composition works end-to-end with a real codec lift.

#### M3.2.2 The `Collection<T>` type assembly is target-agnostic relative to async codecs

`Collection<TContract, ModelName>`, its `.first()` / `.all()` / `for await` shapes, and the `CreateInput` / `MutationUpdateInput` write surfaces are all derived from the same column type-map (`FieldJsType<TContract, ModelName, K>` rooted in `DefaultModelRow`). The shape of an "async codec" at the type-map layer is identical to the shape of a "sync codec": both produce a single `TOutput` for the column. The async-versus-sync distinction lives entirely in the runtime layer (m2's `await codec.decode(wireValue)`); it never propagates into the type-map. This is the design point that makes AC-OC3 ("one field type-map") trivially true on disk — there was no read/write split to remove because none was ever introduced.

### M3.3 Boundary correctness at m3

- **Read boundary: runtime → ORM lane → user code.** The boundary at the ORM lane's *consumption* side is the `for await (const rawRow of source)` loop in `dispatchCollectionRows` (and the parallel `.toArray()` consumer for terminal operations). At this point, `rawRow` is already a plain `Record<string, unknown>` whose codec-backed cells have been awaited by the runtime's generator. The ORM lane's only further work is structural mapping (`mapStorageRowToModelFields`, `mapPolymorphicRow`, `stripHiddenMappedFields`, include stitching) — all codec-agnostic operations on plain values. The `for await` loop in the integration test's "for-await streaming" case proves this concretely: each yielded row's `embedding` cell is a plain `number[]`, never a Promise.
- **Write boundary: ORM lane → runtime → driver.** Write surfaces accept plain `T` (verified at the type level). The ORM lane assembles a `CreateInput` / `MutationUpdateInput` value object and passes it down to `executeQueryPlan` → `runtime.execute` for an `INSERT` / `UPDATE` plan. The runtime's `await encodeParams` boundary is responsible for the `T → Promise<TWire>` lift (m2's M2.1.1). The integration test's `select embedding::text` round-trip on lines 114–119 is the live evidence: a plain `number[]` write surface produces the codec's `'[0.1,0.2,0.3]'` wire format on disk, with no driver-side string coercion or Promise leak.
- **Type-map boundary: contract → ORM lane.** `DefaultModelRow<TContract, ModelName>` is the structural seam between the contract's typed column descriptors (which carry the codec id and `FieldJsType` mapping) and the ORM client's surface types. There is one field type-map; reads and writes both derive from it (M3.1.3 above). This is the correct boundary — any reshape of codec output types (e.g. adding a per-codec async marker, or a read/write split) would have to go through `DefaultModelRow`, and the m3 type tests would catch it.

### M3.4 Risks at m3

- **None expected — verification-only milestone.** m3 introduces no new production code in `sql-orm-client/src/` apart from a single doc comment in `collection-dispatch.ts` (commit `41e01b5f3`); even that doc comment is documentation-only and does not change runtime behaviour. The risk surface from m3 is therefore close to zero. The one concrete defect — F3 (duplicate header doc comments referencing a deleted test file) — is a documentation hygiene issue with a one-edit fix; it does not affect any runtime behaviour or any AC's substance.
- **Cross-package test fixture maintenance debt (latent, addressed in m3).** The m1 codec-interface bump structurally regressed `extension-pgvector`'s unit tests; the implementer folded the fixup into the m3 test commit because the cause is shared (m1 codec-interface bump) and the fix is mechanical (cast through `AsyncVectorCodec`, `await` every `encode`/`decode`, switch `expect(...).toThrow` to `await expect(...).rejects.toThrow`). Triaged as no scope creep — see code review § m3 R1 triage item 5.
- **No new walk-back constraints introduced.** Re-checked the seven-item walk-back inventory at m3 (per NFR #5 / AC-DW2): no marker / no variants / no predicates / no conditional return types / no `TRuntime` / no mis-framed author-surface docs / no async-dependent public guarantees. m3 is structurally consistent with the m1 + m2 design.

### M3.5 ADRs (delta)

m3 modifies no ADR. The new ADR documenting the single-path query-time design remains scheduled for **m5 (T5.6 / T5.7)**, with a "Superseded by" pointer added to [ADR 030](../../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md). The m5 ADR will collapse the m1 + m2 + m3 sections of this SDR into a durable architectural record. The m3-specific points worth preserving in the ADR:

- Codec dispatch is concentrated in the runtime layer; consuming lanes (ORM, raw SQL, future Mongo) never call `codec.encode` / `codec.decode` directly.
- The ORM client uses one field type-map per model (no read/write split). `CreateInput`, `MutationUpdateInput`, and friends derive from `DefaultModelRow`, which itself derives from the contract's `FieldJsType`. The async-versus-sync distinction lives only at the runtime layer.

### M3.6 Test strategy adequacy at m3

#### M3.6.1 What m3 actually proves

- **ORM-level type assertions for read + write surfaces (AC-OC1, AC-OC2, AC-OC3).** [test/codec-async.types.test-d.ts](../../../packages/3-extensions/sql-orm-client/test/codec-async.types.test-d.ts) provides 21 type tests across three sections: (a) read surfaces — `DefaultModelRow`, `InferRootRow`, `Collection.first()`, `Collection.all()` async iterator, `Collection.all().firstOrThrow()`; (b) write surfaces — `CreateInput`, `MutationUpdateInput`, `UniqueConstraintCriterion`, `ShorthandWhereFilter`; (c) negative tests — `IsPromiseLike<…> = false` on every read+write field position, plus equality assertions pinning `CreateInput`/`MutationUpdateInput` to `DefaultModelRow` field types (one type-map invariant).
- **Live-Postgres roundtrip evidence for AC-CF4 (full ORM E2E swap) and AC-RT2 (no Promise leaks).** [test/integration/codec-async.test.ts](../../../packages/3-extensions/sql-orm-client/test/integration/codec-async.test.ts) provides 5 integration tests: `.first()` for both vector and jsonb codec columns; `for await` streaming for vector; `create()` for both vector and jsonb (with `select embedding::text` and `select address` wire-format roundtrip assertions); `update()` for vector. Both codecs have synchronous author functions; the m1 `codec()` factory lifts both to Promise-returning; the m2 runtime awaits both at the encode and decode boundaries. The integration test exercises this entire composition with no mocks, no synthesized drivers, and no codec-author-side fictions — it is the strongest possible evidence for AC-CF4's "sync codec works through runtime; replacing with async also works" claim.
- **`extension-pgvector` unit-test alignment.** [packages/3-extensions/pgvector/test/codecs.test.ts](../../../packages/3-extensions/pgvector/test/codecs.test.ts) restored to green via mechanical fixup (cast to `AsyncVectorCodec`; `async` test bodies; `await` codec calls; `rejects.toThrow` on rejection paths). Verifies the codec author surface still produces correct wire values under the m1 + m2 boundary.

#### M3.6.2 What m3 cannot yet prove (deferred)

- **Cross-family parity (AC-CX1–AC-CX5).** m4 work; Mongo's local `Codec` shape is unchanged at m3.
- **Security-side guarantees (AC-SE1–AC-SE4) and ADR / walk-back closure (AC-DW1–AC-DW3).** m5 work.

### M3.7 Open questions for m4 review

These are forward-looking items the m4 reviewer should keep in scope:

1. **Mongo encode-side runtime parity.** m2 established the SQL runtime's `await encodeParams` boundary and the two `Promise.all` dispatch sites. m4's T4.1–T4.5 will reshape `mongo-codec`, `mongo-lowering`, and `MongoRuntime.execute` to match. The reviewer should verify the same architectural points hold: (a) one factory (`codec()` from `relational-core`) used by both families; (b) `MongoAdapter.lower()` is async; (c) `MongoRuntime.execute()` awaits `adapter.lower(plan)`; (d) `resolveValue` async with `Promise.all` concurrent dispatch; (e) no SQL-specific assumptions leak into Mongo runtime, and no Mongo-specific shape leak back into the SQL runtime.
2. **`mongo-codec` factory shape adoption (T4.2) and the latent `as unknown as TTraits` cast (F1).** F1 was re-recorded as an m4 T4.2 sub-task at m1 R2; the m4 reviewer should verify whether the cast is dropped (preferred — express the empty-traits default as `[] as unknown[] as TTraits` with a one-line comment, or restructure to avoid the cast entirely) or retained with an explanatory comment.
3. **`InferRootRow` for polymorphic Mongo models.** m3's verification was scoped to SQL contracts. m4's plan should ensure the polymorphic `InferRootRow` invariant (M3.1.1) holds for Mongo's discriminator/variant model shape, and add a parallel type-test if the surface is reached by an async codec column. If m4 does not exercise polymorphic + async-codec interaction, the m5 reviewer should confirm there is no regression-test gap.
4. **Plan-walker / `WeakMap` / `instanceof Promise` defensive guards.** Verified absent at m2 and m3. m4 should re-check after `MongoRuntime.execute` reshape, particularly around the lower-then-execute boundary and any new dispatch path Mongo introduces.

### M3.8 ADR-shape decisions made at m3 (none new; continuity check)

m3 introduces no new architectural decisions beyond what m1 and m2 prefigured. Every m3 invariant (M3.1.1 through M3.1.4) is consistent with the design captured in [alternative-design.md](../../../wip/review-code/pr-375/alternative-design.md) and the m1 + m2 sections of this SDR. The ORM lane's plain-`T` exposure is not an architectural choice independent of the runtime's await-at-the-boundary design — it is the *logical consequence* of that design propagating through unchanged. m3 records that consequence on disk (in tests + a doc comment); m5's ADR will document it.

## M3 — Round 2 — F3 closure (design stable)

> **Scope.** Reflects HEAD `aa50f7280`. m3 R2 is **SATISFIED** ([code-review.md § m3 — Round 2](code-review.md)) on the strength of one commit (`aa50f7280`) closing the only open finding from R1.

R2 is a doc-comment cleanup on a single file: commit `aa50f7280` collapses the two stacked top-level `/** … */` blocks at the head of [`packages/3-extensions/sql-orm-client/src/collection-dispatch.ts`](../../../packages/3-extensions/sql-orm-client/src/collection-dispatch.ts) (former lines 1–31) into a single header block (now lines 1–15). The merged block preserves block 1's substance — including the canonical cross-link to [`packages/2-sql/5-runtime/src/codecs/decoding.ts`](../../../packages/2-sql/5-runtime/src/codecs/decoding.ts) — folds in the ADR 030 cross-link uniquely contributed by block 2, points test references at the surviving files (`test/integration/codec-async.test.ts` and `test/codec-async.types.test-d.ts`), and drops the dangling reference to the deleted `test/codec-async.e2e.test.ts`. No runtime code, types, exports, or imports were touched (`git diff 41e01b5f3..aa50f7280 --stat` reports a single file changed, 3 insertions / 19 deletions). All design invariants captured in M3.1 through M3.7 above remain stable — no new guarantees, no new boundaries, no new risks, no new ADR-shape decisions. The only on-disk effect is that the codec-agnostic-dispatch invariant recorded in M3.1.4 is now documented in a single, internally consistent header doc block instead of a redundant pair, and the documentation no longer points readers at a deleted file. HEAD now `aa50f7280`.

## M4 R1 — Mongo cross-family parity

> **Scope.** Reflects HEAD `415d72c1c`. m4 R1 is **ANOTHER ROUND NEEDED** ([code-review.md § m4 — Round 1](code-review.md)) on the strength of one open should-fix finding (F4 — `mongo-lowering` package README signature stale). The substantive design picture for m4 — Mongo encode-side runtime parity with SQL — is **complete on disk**; F4 is documentation hygiene, not architectural.

### M4.1 New guarantees / invariants confirmed at m4

m4 propagates the m1 + m2 + m3 single-path async-codec design across the Mongo family's encode-side runtime, mirroring the SQL pattern established in M2. Per the plan's m4 § Scope note, the decode side is intentionally out of scope (Mongo does not decode rows today — adding one would invent a new subsystem orthogonal to async codecs). The encode side is fully reshaped. The five m4-owned ACs (AC-CX1 through AC-CX5) are now PASS on disk; the additive m4 section of AC-DW2 (walk-back constraints) is also clean.

#### M4.1.1 Mongo `Codec` interface aliases the framework `BaseCodec` (verification of AC-CX1)

[packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L21–L26)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:21-26) declares `MongoCodec<Id, TTraits, TWire, TJs>` as a type alias of `BaseCodec<Id, TTraits, TWire, TJs>`. The query-time methods (`encode`, `decode`) are Promise-returning at the boundary; the build-time methods (`encodeJson`, `decodeJson`, `renderOutputType`) are synchronous. Mongo-specific extensions (parameterized codecs, target hints, etc. — analogous to SQL's `meta`/`paramsSchema`/`init`) are not currently introduced; the JSDoc on the alias explicitly defers them ("Any divergence should be added here"). The `mongoCodec()` factory at L39–L70 mirrors the SQL `codec()` factory's lift mechanic: sync author functions are uniformly lifted to Promise-returning methods via `async (value) => userEncode(value)` / `async (wire) => userDecode(wire)` (L65–L66). One sound asymmetry between the two interfaces is recorded as an open question for the orchestrator/user (M4.7.1 below): `MongoCodec` declares 4 generics (collapsing `TInput=TOutput=TJs`) where `BaseCodec` has 5 generics (`TInput`, `TOutput=TInput`); the cross-family test substantively demonstrates parity for the `TInput=TOutput` case, but a SQL codec authored with `TInput≠TOutput` would not fit the narrower `MongoCodec` alias. Reviewer's permissive interpretation of AC-CX1's "structurally identical" wording: PASS, with the asymmetry surfaced for an explicit orchestrator/user decision.

#### M4.1.2 Single `codec({...})` value works in both family registries (verification of AC-CX2)

[test/integration/test/cross-package/cross-family-codec.test.ts (L18–L77)](../../../test/integration/test/cross-package/cross-family-codec.test.ts:18-77) constructs a single SQL `codec({...})` value (`shared/object-id-like@1`, with sync `encode: (value: string) => ` `wire:${value}` ` and the inverse `decode`), then registers the **same value** in both `createCodecRegistry()` (SQL) and `createMongoCodecRegistry()` (Mongo). The three subtests pin the substance: (a) `sqlCodec.encode('abc-123')` and `mongoCodecLookup.encode('abc-123')` both produce `'wire:abc-123'`, and the values are equal; (b) the Mongo encode path through `resolveValue(MongoParamRef('abc-123', { codecId: 'shared/object-id-like@1' }), mongoRegistry)` produces the same wire output as the SQL `encode`; (c) SQL `decode` is the inverse of `encode` on the same codec value. The test demonstrates that one codec definition serves both directional boundaries — exactly the AC-CX2 promise. The "single module import" pattern is satisfied by the SQL `codec()` factory's output structurally fitting both registries, not by re-instantiating the codec twice; this is the architecturally correct interpretation since codec identity (the `id` field) is the registry key and re-instantiation would defeat the parity claim.

#### M4.1.3 `resolveValue` is async with `Promise.all` concurrent dispatch (verification of AC-CX3)

[packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts (L14–L44)](../../../packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts:14-44) is `async`; it awaits `codec.encode(value.value)` for `MongoParamRef` leaves with a registered `codecId` (L21); it dispatches array children concurrently via `Promise.all(value.map((v) => resolveValue(v, codecs)))` (L32); it dispatches object children concurrently via `Promise.all(entries.map(([, val]) => resolveValue(val, codecs)))` (L35). The `Promise.all` semantics align with M2.1.4 (the SQL runtime's `encodeParams` and `decodeRow` dispatch sites): fail-fast on rejection, concurrent dispatch on success. The structural symmetry between the SQL runtime's two-place codec-dispatch concentration and the Mongo encode-side equivalent is therefore exact: SQL has `encodeParams` + `decodeRow`; Mongo has `resolveValue` (used during `lower()` by the adapter). The decode-side analogue is intentionally absent (M4 § Scope note).

#### M4.1.4 `MongoAdapter.lower()` is async at the interface level (verification of AC-CX4)

[packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts (L4–L6)](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:4-6): `interface MongoAdapter { lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>; }`. The implementation in [packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts (L57–L142)](../../../packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts:57-142) is `async lower(...)`. `#resolveDocument` is `async` and uses `Promise.all` over object entries (L37–L48). Where `lower()` performs encode-side reshape with multiple independent sub-tasks, it dispatches them concurrently via `Promise.all`: `updateOne`/`updateMany`/`findOneAndUpdate` await `[lowerFilter(filter), this.#lowerUpdate(update)]` together (L66–L69, L78–L81, L89–L92); `insertMany` awaits `Promise.all(documents.map((doc) => this.#resolveDocument(doc)))` (L75); aggregate pipelines lower stages concurrently via `lowerPipeline` (uses `Promise.all` internally). Raw command variants bypass codec lowering entirely (L110–L134) — the spec's "raw escape hatch" semantics are preserved. The implementation pattern matches the SQL runtime's `await encodeParams` → core-iterator → `await decodeRow` pattern at M2.1.2: codec dispatch is the only async work; everything else (wire-command construction, plan selection, raw passthrough) stays synchronous within the async function body.

#### M4.1.5 `MongoRuntime.execute()` awaits `adapter.lower(plan)` (verification of AC-CX5)

[packages/2-mongo-family/7-runtime/src/mongo-runtime.ts (L74)](../../../packages/2-mongo-family/7-runtime/src/mongo-runtime.ts:74): `const wireCommand = await adapter.lower(plan);`. The await sits between middleware `beforeExecute` invocations (L68–L72) and `driver.execute(wireCommand)` (L76), meaning lowering runs after `beforeExecute` and before the driver sees the wire command. This is the structural correct ordering: middleware can transform the plan; lowering produces the wire command; the driver consumes the wire command. Two additional consumer call sites in [packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts (L262, L310)](../../../packages/3-mongo-target/1-mongo-target/src/core/mongo-runner.ts:262-310) (DML data-transform op-run and read-only check evaluation) also `await adapter.lower(...)`. A workspace-wide `rg 'lower\('` audit confirms zero unawaited code-level call sites; the only non-code occurrence is the F4 stale README narrative.

### M4.2 Subsystem fit at m4

#### M4.2.1 Mongo encode-side runtime now mirrors SQL's encode-side pattern

m2 established the SQL runtime's two-place codec-dispatch concentration (M2.1.4): `encodeParams` (write path) and `decodeRow` (read path), both async, both `Promise.all`-dispatched. m4 lands the Mongo encode-side equivalent: `resolveValue` (the recursive document-walker that resolves `MongoParamRef` leaves) and `MongoAdapterImpl#lower()` (the per-command lowering surface that calls `resolveValue` and `lowerFilter`/`lowerPipeline`). The structural pattern is identical:

- **Codec dispatch is concentrated in the runtime layer.** Just as the SQL ORM lane never calls `codec.encode`/`codec.decode` directly (M3.2.1), the Mongo runtime stack (`mongo-runner`, `mongo-runtime`) never calls `codec.encode` directly. The only call site is `resolve-value.ts:21` (`return codec.encode(value.value)`) — invoked transitively from `MongoAdapterImpl#resolveDocument` and `lowerStage`/`lowerFilter`. This concentration is the design point: codec call discipline lives in **one** place per family per direction.
- **`Promise.all` propagation through the lowering chain.** A user's call to `runtime.execute(plan)` produces a wire command via `adapter.lower(plan)`; that lowering walks `MongoExpr` trees (via `resolveValue`) and aggregation pipelines (via `lowerPipeline` → `lowerStage`); each leaf-level codec call is awaited; sibling leaves dispatch concurrently. The fan-out is exactly the same as M2.1.4's per-row decode and per-param encode: independent sub-trees encode in parallel, dependent ones serialize through `await`.
- **Build-time methods stay synchronous.** Just as `validateContract` and `postgres({...})` stay sync at the m2 boundary (AC-RT3, AC-RT4), `validateMongoContract` and `createMongoAdapter()` stay sync at the m4 boundary (T4.10's two regression suites enforce this at type + runtime).

#### M4.2.2 Cross-family codec interface is the framework `BaseCodec`

The `BaseCodec` interface in [`packages/1-framework/1-core/framework-components/src/codec-types.ts`](../../../packages/1-framework/1-core/framework-components/src/codec-types.ts) is the single source of truth for the cross-family codec contract. Both SQL `Codec` and Mongo `MongoCodec` derive from it: SQL extends with `meta`/`paramsSchema`/`init` (parameterized-codec metadata); Mongo aliases without extending. Cross-family codec sharing works because both registries (`createCodecRegistry()` and `createMongoCodecRegistry()`) consume `BaseCodec` shape — a SQL codec's structural compatibility with `MongoCodec` is mediated through `BaseCodec`. This is the architecturally correct seam: cross-family parity is a **shape contract** at `BaseCodec`, not a syntactic alias of the SQL `Codec` interface. Future Mongo-specific extensions (e.g. `_id`-handling hints, nested-document path metadata) can be added to `MongoCodec` without breaking the cross-family contract for codecs that don't need them.

#### M4.2.3 The wire-command construction stays target-specific

`MongoAdapter.lower()` returns `Promise<AnyMongoWireCommand>` — Mongo's wire-command union ([`@prisma-next/mongo-wire`](../../../packages/2-mongo-family/6-transport/mongo-wire)). SQL's analogous lowering returns its own SQL plan/AST shape. The async-codec reshape does not collapse these into a unified return type; each family keeps its own wire format and lowering target. This is the right boundary: cross-family parity is at the **codec interface** (the value-conversion contract), not at the **wire format** (which is intrinsically family-specific). m4 reinforces this: the only cross-family seam is the codec shape; everything downstream (wire command, driver, server protocol) stays target-bound.

### M4.3 Boundary correctness at m4

- **Encode boundary: user code → ORM → runtime → adapter → `resolveValue` → codec.** A user's `posts.create({ embedding: [...] })` (or its Mongo equivalent) hands a plain `T` value into the ORM; the ORM assembles a `MongoQueryPlan` whose `MongoParamRef` leaves carry the `codecId`; `MongoRuntime.execute(plan)` awaits `adapter.lower(plan)`; lowering calls `#resolveDocument` which calls `resolveValue` which awaits `codec.encode(...)` on each `MongoParamRef` leaf. Every step downstream of the codec sees a plain wire value (the codec's `TWire` output). No Promise leaks into the wire command; no Promise leaks into the driver. The sync construction of `createMongoAdapter()` (T4.10 regression) and `validateMongoContract()` (T4.10 regression) enforces that build-time methods stay synchronous, so contract loading and adapter instantiation never need `await`.
- **Cross-family codec registration boundary.** A SQL `codec({...})` value structurally fits `MongoCodecRegistry.register(codec)` because both registries accept `BaseCodec` shape (with their respective extensions optional or absent). The cross-family test demonstrates this concretely. The 4-vs-5 generic asymmetry on `MongoCodec` (M4.1.1) does not affect registration of a SQL codec where `TInput=TOutput`; it only matters if a SQL codec is authored with `TInput≠TOutput` and the user wants to treat the same value as a typed `MongoCodec` (which collapses to `TJs=TInput=TOutput`). This is a narrow edge case; AC-CX2's substantive demand — single codec value works in both registries — is met for the common case.
- **Middleware boundary: `beforeExecute` → `lower` → driver.** The `mongo-runtime`'s `await adapter.lower(plan)` sits between middleware `beforeExecute` invocations and the driver. Middleware can transform the plan (synchronously or via `Promise`), but the lowering itself is the runtime's responsibility; middleware does not see the wire command. This is the correct boundary: middleware is a plan-level concern; lowering is a wire-level concern; codec dispatch is a value-level concern. The three are separated by clear async/sync seams.

### M4.4 Risks at m4

- **`MongoCodec` 4-vs-5 generic asymmetry vs `BaseCodec`.** Documented in M4.1.1; surfaced as § Items for the user's attention in [code-review.md](code-review.md). Reviewer's permissive read PASSes AC-CX1 on the strength of the cross-family test substantively demonstrating parity for the `TInput=TOutput` case; an orchestrator/user decision is requested on whether to expand `MongoCodec` to 5 generics for strict spec compliance. Not a blocker for m4 SATISFIED.
- **Pre-existing `MongoMigrationRunner` CAS flake (out of scope).** Implementer flagged a flake in [`packages/3-mongo-target/1-mongo-target/test/mongo-runner.test.ts:330`](../../../packages/3-mongo-target/1-mongo-target/test/mongo-runner.test.ts:330) (`returns MARKER_CAS_FAILURE when concurrent marker change causes CAS miss`). Diff verification (test file byte-identical between m3 and m4 HEAD; runner-src diff is solely the two T4.8 `await adapter.lower(...)` lines, which apply only to DML data-transform plans, not the failing test's DDL `createIndex` path) confirms this is pre-existing fragility, not a regression. Surfaced as § Items for the user's attention #2 — the concrete fix ("await the `onOperationComplete` callback at line 174 of `mongo-runner.ts`") is out of m4 scope (migration-runner CAS semantics are unrelated to codec-async runtime). Reviewer-side run did not reproduce the flake (366/366 PASS in `target-mongo`).
- **Documentation hygiene defect (F4).** [`packages/2-mongo-family/6-transport/mongo-lowering/README.md` line 7](../../../packages/2-mongo-family/6-transport/mongo-lowering/README.md:7) narrates the pre-m4 sync signature `lower(plan: MongoQueryPlan): AnyMongoWireCommand`; the post-m4 interface is `Promise<AnyMongoWireCommand>`. This is the only blocker for m4 SATISFIED; one-line README edit closes it. The plan's m5 T5.8 mentions `mongo-adapter` for README refresh; flagging the `mongo-lowering` README now (rather than at m5) prevents a stale contributor-facing signature from sitting on `main` between m4 and m5.
- **No new walk-back constraints introduced.** Re-checked the seven-item walk-back inventory at m4 (per NFR #5 / AC-DW2): no per-codec async marker (Mongo factory uniformly lifts; no `runtime`/`kind` field on `MongoCodec`); no `codecSync`/`codecAsync` variants; no `isSyncEncoder`/`isSyncDecoder` predicates; no conditional return types on Promise-returning methods; no `TRuntime` generic on `MongoCodec`; no mis-framed author-surface docs (Mongo factory JSDoc explicitly says "Authors may write `encode` / `decode` as sync or async; the factory lifts uniformly"); no async-dependent public guarantees added to `validateMongoContract` or `createMongoAdapter` (T4.10 regressions enforce sync). m4 is structurally consistent with the m1 + m2 + m3 design.

### M4.5 ADRs (delta)

m4 modifies no ADR. The new ADR documenting the single-path query-time async codec design remains scheduled for **m5 (T5.6 / T5.7)**, with a "Superseded by" pointer added to [ADR 030](../../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md). The m5 ADR will absorb the m1 + m2 + m3 + m4 sections of this SDR. The m4-specific points worth preserving in the ADR:

- Cross-family codec parity is a **shape contract at `BaseCodec`**, not a syntactic alias. SQL and Mongo each derive from `BaseCodec` and may extend with family-specific extras (`meta`/`paramsSchema`/`init` for SQL; nothing currently for Mongo). A single `codec({...})` value works in both registries when the codec author needs no family-specific extras.
- Encode-side runtime parity is implemented identically per family: codec dispatch is concentrated in the runtime layer (SQL: `encodeParams`/`decodeRow`; Mongo: `resolveValue`/`MongoAdapter#lower`); `Promise.all` propagates concurrent dispatch; build-time methods stay synchronous.
- Decode-side runtime parity is intentionally **out of scope** for the async-codec project; Mongo does not currently decode rows, and adding one would invent a new subsystem. The ADR should document this scoping decision and identify it as the natural next-project boundary.

### M4.6 Test strategy adequacy at m4

#### M4.6.1 What m4 actually proves

- **Cross-family codec parity (AC-CX1, AC-CX2).** The cross-family integration test ([`test/integration/test/cross-package/cross-family-codec.test.ts`](../../../test/integration/test/cross-package/cross-family-codec.test.ts)) is the strongest possible evidence: a single SQL `codec({...})` value is registered in both family registries; the encode wire output is byte-equal across both registries; the Mongo encode path through `resolveValue` produces the same wire output as the SQL `codec.encode()`; SQL `decode` round-trips. The 3/3 PASS in `pnpm test:integration` (104 files, 521 tests, 51.47s) demonstrates the substantive cross-family parity claim.
- **Async dispatch + `Promise.all` concurrency (AC-CX3, AC-CX4).** [packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts (L82–L170)](../../../packages/3-mongo-target/2-mongo-adapter/test/resolve-value.test.ts:82-170) uses deferred-promise call-order assertions (`encode-a-start`/`encode-b-start` recorded before either resolves; setImmediate gate) to verify concurrent dispatch over object children and array elements. [packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts](../../../packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts) covers all eight non-raw command kinds with `await adapter.lower(plan)` assertions, plus codec-encoded `MongoParamRef` round-trips through the lowering chain (`uppercase` test codec encoding `'alice'` → `'ALICE'` in `insertMany`, `updateOne`, etc.). 215/215 PASS in `pnpm --filter @prisma-next/adapter-mongo test`.
- **Sync regression for build-time methods (T4.10).** [packages/2-mongo-family/1-foundation/mongo-contract/test/validate.test.ts (L662–L681)](../../../packages/2-mongo-family/1-foundation/mongo-contract/test/validate.test.ts:662-681) and [packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts (L435–L453)](../../../packages/3-mongo-target/2-mongo-adapter/test/mongo-adapter.test.ts:435-453) pin `validateMongoContract` and `createMongoAdapter` to sync return types at both type and runtime. If either ever drifts to Promise-returning, both test types and the runtime `expect(typeof thenable.then).toBe('undefined')` checks fail.
- **Adapter-side codec test coverage (T4.3).** [packages/3-mongo-target/2-mongo-adapter/test/codecs.test.ts](../../../packages/3-mongo-target/2-mongo-adapter/test/codecs.test.ts) verifies all built-in Mongo codecs (`mongoObjectIdCodec`, `mongoStringCodec`, `mongoDoubleCodec`, etc.) `await encode`/`decode` per the new Promise-returning boundary; the codec author functions stay sync (factory lifts).

#### M4.6.2 What m4 cannot yet prove (deferred)

- **Security tests translated from PR #375 (AC-SE1–AC-SE4).** m5 work; envelope redaction, validator-message redaction, JSON-Schema failure shape, include-aggregate redaction.
- **ADR + walk-back closure (AC-DW1–AC-DW3).** m5 work; the ADR will cite the cross-family parity design point recorded above.

### M4.7 Open questions for m5 review

1. **`MongoCodec` 4-vs-5 generic asymmetry — strict vs permissive AC-CX1 reading.** Surfaced in [code-review.md § Items for the user's attention #1](code-review.md). m5's reviewer should record the orchestrator/user decision in the ADR (T5.6) — either "Mongo deliberately collapses `TInput=TOutput=TJs` because the family has no current need for asymmetric input/output codecs" (permissive) or "the `MongoCodec` alias was expanded to 5 generics matching `BaseCodec` to satisfy strict spec wording" (strict). Either path is defensible; the documentation should be unambiguous in the ADR.
2. **Migration-runner CAS robustness follow-up.** Surfaced in [code-review.md § Items for the user's attention #2](code-review.md). The pre-existing `MongoMigrationRunner` CAS flake is out of scope for m4/m5; m5's reviewer should confirm the orchestrator has logged a separate follow-up issue and not attempted to absorb the fix into m5. The `await onOperationComplete` callback fix is concrete but unrelated to async codecs.
3. **Mongo decode path (out of project scope).** Mongo does not decode rows today (M4 § Scope note). m5's ADR should record this as the natural next-project boundary: when Mongo grows row decoding, the implementation should mirror SQL's `decodeRow` pattern (single-armed dispatch, `Promise.all` per-cell, await before yield). The walk-back constraints from NFR #5 should explicitly carry forward.
4. **Plan-walker / `WeakMap` cache / `instanceof Promise` defensive guards.** Verified absent at m2, m3, and m4 (`rg 'instanceof Promise|WeakMap|plan-walker' packages/2-mongo-family packages/3-mongo-target` returns zero matches). m5's reviewer should re-check after the security-tests translation lands and the ADR is authored, particularly around any new envelope-redaction code paths.

### M4.8 ADR-shape decisions made at m4 (none new; continuity check)

m4 introduces no new architectural decisions beyond what m1 + m2 + m3 prefigured. The cross-family codec parity, the encode-side runtime symmetry, and the build-time sync invariants are all logical extensions of the m1 codec interface design and the m2 SQL runtime pattern. m4's contribution is **propagation through a second target family**, not new architectural ground. The m5 ADR will record this propagation as evidence of the design's portability.

## M4 R2 — strict cross-family parity (MongoCodec widening) + F4 closure

> **Scope.** Reflects HEAD `47ce86a6f`. m4 R2 is **SATISFIED** ([code-review.md § m4 — Round 2](code-review.md)) on the strength of two commits: `6f567afa3` (F4 README fix) and `47ce86a6f` (MongoCodec widening). No open findings. Strict cross-family parity at the `BaseCodec` seam is now achieved.

### M4 R2.1 What changed since m4 R1

R2 lands two complementary changes that together close out m4:

1. **Documentation hygiene: F4 closed.** [`packages/2-mongo-family/6-transport/mongo-lowering/README.md` line 7](../../../packages/2-mongo-family/6-transport/mongo-lowering/README.md:7) now narrates the post-m4 interface signature `lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>` and adds a sentence on async-at-the-boundary semantics (`callers must await lower(...) so adapters may run async codec encodes (e.g. resolveValue) before producing the wire shape`). The narrated signature exactly matches the source-of-truth interface in [`packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts (L5)`](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:5). The added async-semantics sentence is a value-add over the minimum F4 fix recipe and is consistent with the implementer's mandate: it tells contributors not just what the type is, but why it's a `Promise` (so async codec encodes can run before the wire shape is produced).

2. **Architectural promotion: `MongoCodec` widening.** [`packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts`](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts) widens `MongoCodec` from 4 generics (`<Id, TTraits, TWire, TJs>`) to **5 generics matching `BaseCodec` exactly** (`<Id, TTraits, TWire, TInput, TOutput = TInput>`) and aliases directly to `BaseCodec<Id, TTraits, TWire, TInput, TOutput>`. The `mongoCodec()` factory carries the same 5 generics with `TOutput = TInput` default; `encode: (value: TInput) => TWire | Promise<TWire>`, `decode: (wire: TWire) => TOutput | Promise<TOutput>`, `encodeJson: (value: TInput) => JsonValue`, `decodeJson: (json: JsonValue) => TInput` thread the `TInput`/`TOutput` split through every method position that needs it. The legacy `MongoCodecJsType<T>` extractor is replaced (no backcompat alias, per the implementer's mandate) by `MongoCodecInput<T>` and `MongoCodecOutput<T>`, mirroring SQL's `CodecInput<T>` / `CodecOutput<T>` positionally.

The widening fully resolves the R1 escalation about generic-arity asymmetry between `MongoCodec` and `BaseCodec` (M4.1.1 / M4.7.1). M4.1.1's narrative is superseded below; M4.7.1's open question is resolved.

### M4 R2.2 New invariant: strict structural identity at the `BaseCodec` seam (revised verification of AC-CX1)

The cross-family codec contract is now structurally identical at the `BaseCodec` seam between SQL and Mongo:

- **`MongoCodec<Id, TTraits, TWire, TInput, TOutput=TInput> = BaseCodec<Id, TTraits, TWire, TInput, TOutput>`** ([packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L30–L36)](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:30-36)) — Mongo aliases `BaseCodec` directly; same generic count, same generic order, same defaults.
- **SQL `Codec<Id, TTraits, TWire, TInput, TOutput, TParams, THelper> extends BaseCodec<Id, TTraits, TWire, TInput, TOutput>`** ([packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts](../../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts)) — SQL extends with family-specific extras (`meta`/`paramsSchema`/`init`/`TParams`/`THelper`), but the structural seam at `BaseCodec` is identical.
- **The cross-family contract is at `BaseCodec`**, not at the family-specific subtypes. A codec value that fits the `BaseCodec<Id, TTraits, TWire, TInput, TOutput>` shape is now structurally usable in both family registries — including the asymmetric `TInput ≠ TOutput` case, which was structurally impossible under R1's 4-generic `MongoCodec`.

Strict structural identity is pinned by type-level tests at [packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts (L65–L94)](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:65-94):

- **L65–L69:** `expectTypeOf<MongoCodec<'id/x@1', readonly ['equality'], number, string, Date>>().toEqualTypeOf<BaseCodec<'id/x@1', readonly ['equality'], number, string, Date>>()` — `toEqualTypeOf<BaseCodec<…>>()` directly proves identity at the 5-generic positional level (not just functional equivalence; not just shape equivalence — strict positional identity).
- **L71–L75:** `TOutput = TInput` default — omitting `TOutput` in `MongoCodec<…, string>` produces the same type as explicit `MongoCodec<…, string, string>`.
- **L82–L94:** Asymmetric expressibility through method signatures — a codec with `encode: (value: string) => Number(value)` and `decode: (wire: number) => new Date(wire)` produces `Parameters<typeof asymmetric.encode>[0] = string`, `ReturnType<typeof asymmetric.encode> extends Promise<number>`, `Parameters<typeof asymmetric.decode>[0] = number`, `ReturnType<typeof asymmetric.decode> extends Promise<Date>`. This proves the asymmetric case is fully expressible at the factory and method-signature level.

AC-CX1 is therefore **strictly PASS** at R2: the spec's "structurally identical to the SQL `Codec` interface (same generic parameters …)" wording is now satisfied at the `BaseCodec` seam — the layer at which cross-family codec sharing actually happens. SQL's family-specific extras (`meta`/`paramsSchema`/`init`/`TParams`/`THelper`) are correctly held at the SQL family layer, not in the cross-family contract.

### M4 R2.3 Subsystem fit (refresh)

#### M4 R2.3.1 Cross-family parity is now at the `BaseCodec` seam, not at a syntactic alias

M4.2.2's narrative is reaffirmed and strengthened. Both SQL `Codec` and Mongo `MongoCodec` now derive from `BaseCodec` with **identical 5-generic shape**: SQL extends with family-specific extras, Mongo aliases without extending. The cross-family seam is at `BaseCodec<Id, TTraits, TWire, TInput, TOutput>`, where:

- The 5 generics are positionally identical between the two families.
- `TOutput = TInput` is the default in both families' constructors.
- Query-time methods (`encode`, `decode`) are Promise-returning; build-time methods (`encodeJson`, `decodeJson`, `renderOutputType`) are synchronous; both families lift sync author functions to Promise-shaped methods via `async (x) => fn(x)`.

Future Mongo-specific extensions (e.g. `_id`-handling hints, nested-document path metadata) can still be added to `MongoCodec` without breaking the cross-family contract — but they would now be **additive** rather than **structural**, exactly mirroring how SQL adds its family-specific extras.

#### M4 R2.3.2 Asymmetric `TInput ≠ TOutput` codecs are now expressible in the Mongo family

The R1 4-generic `MongoCodec<Id, TTraits, TWire, TJs>` collapsed `TInput=TOutput=TJs`, making the asymmetric case (e.g. write `string`, read `Date`) structurally impossible to author or register on the Mongo side. R2's widening removes this constraint: a codec that decodes to a richer type than it accepts on input is now expressible through `mongoCodec()` directly, with the asymmetry surfacing on `Parameters<typeof codec.encode>` and `ReturnType<typeof codec.decode>`. This matches SQL's expressivity exactly. The cross-family parity test ([test/integration/test/cross-package/cross-family-codec.test.ts](../../../test/integration/test/cross-package/cross-family-codec.test.ts)) continues to use the canonical `TInput=TOutput` form (the case used by every built-in codec); the asymmetric case is verified at the type level by the new tests in `codecs.test-d.ts`.

### M4 R2.4 Boundary correctness (refresh)

The encode boundary, cross-family registration boundary, and middleware boundary as described in M4.3 are unchanged — R2's widening is a **structural enrichment** of the cross-family registration boundary, not a change to its location. The 4-vs-5 generic asymmetry caveat in M4.3's "Cross-family codec registration boundary" bullet is **resolved**: a SQL codec authored with `TInput≠TOutput` is now structurally usable in `MongoCodecRegistry.register(codec)` because both registries accept the same 5-generic `BaseCodec` shape.

### M4 R2.5 Risks (refresh)

- **`MongoCodec` 4-vs-5 generic asymmetry (M4.4 bullet #1).** **Resolved** by R2's widening. AC-CX1 is now strictly PASS, not permissively PASS. § Items for the user's attention #1 in [code-review.md](code-review.md) is updated accordingly.
- **F4 (M4.4 bullet #3).** **Resolved** by commit `6f567afa3`. README signature now matches the interface, with an added async-at-the-boundary semantics sentence.
- **Pre-existing `MongoMigrationRunner` CAS flake (M4.4 bullet #2).** Carried over unchanged; reviewer-side did not reproduce in either R1 or R2. Recommend the orchestrator log a follow-up issue; this remains out of project scope.
- **Latent extractor union behavior on asymmetric codecs (new minor consideration, not a finding).** `MongoCodecInput<T>` / `MongoCodecOutput<T>` mirror SQL's `CodecInput<T>` / `CodecOutput<T>` exactly, including a shared latent behavior: both pairs of extractors return `TInput | TOutput` (the union) for asymmetric codecs because TypeScript collapses the `infer` slot with the defaulted `TOutput = TInput` slot. The implementer documented this inline and tested asymmetric expressibility through method signatures (`Parameters<typeof codec.encode>` etc.) rather than through the extractors. This is **not** a finding — it's pre-existing behavior in SQL that the Mongo extractor is required to mirror per the strict-parity mandate. Surfaced under § Items for the user's attention #1 (refresh) for the orchestrator's optional separate user-attention capture; it does not block AC-CX1, since the AC is about the codec interface (which is structurally identical) and the canonical `TInput=TOutput` case is exact.

### M4 R2.6 ADRs (delta)

m4 R2 modifies no ADR. The new ADR (m5 T5.6 / T5.7) will absorb the m4 R2 narrative — specifically: the `BaseCodec` is the cross-family seam; family `Codec` types may add additive extras; the `TInput ≠ TOutput` asymmetric case is uniformly expressible across SQL and Mongo. The R1 SDR's M4.7.1 open question ("strict vs permissive AC-CX1 reading") is **resolved by widening**: the ADR records "Mongo `MongoCodec` was widened to 5 generics matching `BaseCodec` exactly to satisfy strict spec wording and to enable asymmetric `TInput ≠ TOutput` codecs in the Mongo family." No deferral or open user decision remains on this point.

### M4 R2.7 Test strategy adequacy (refresh)

#### M4 R2.7.1 What R2 newly proves

- **Strict structural identity at the `BaseCodec` seam (AC-CX1 strict).** Three new type tests in `mongo-codec/test/codecs.test-d.ts` (L65–L75) pin generic count, order, defaults, and `TOutput=TInput` collapse against `BaseCodec` directly via `toEqualTypeOf<BaseCodec<…>>()`. Asymmetric expressibility is pinned at the method-signature level (L82–L94), and the canonical symmetric case is pinned through the extractors (L102–L112).
- **No consumer breakage from the widening.** All built-in Mongo codecs use the symmetric `TInput=TOutput=TJs` form; the `TOutput = TInput` default makes every existing call site backward-compatible. Verified by `pnpm --filter @prisma-next/adapter-mongo test` (215/215), `pnpm --filter @prisma-next/target-mongo test` (366/366), `pnpm --filter @prisma-next/mongo-codec test` (18/18; +4 new type-test assertions vs R1's 14), and the full package + integration + lint:deps gates.
- **F4 closure verified.** README signature matches `mongo-lowering/src/adapter-types.ts:L5` exactly; async-at-the-boundary semantics narrated for contributors.

#### M4 R2.7.2 What R2 cannot yet prove (deferred to m5)

Same as M4.6.2; no R2-specific deferrals.

### M4 R2.8 Open questions (refresh)

- **M4.7.1 (`MongoCodec` 4-vs-5 generic asymmetry — strict vs permissive AC-CX1 reading).** **Resolved by widening.** The strict reading is now satisfied; no orchestrator/user decision remains.
- **M4.7.2 (Migration-runner CAS robustness follow-up).** Carried over unchanged.
- **M4.7.3 (Mongo decode path).** Carried over unchanged — out of project scope; m5 ADR should document this scoping decision.
- **M4.7.4 (defensive-guard re-check at m5).** Carried over unchanged.
- **New, optional: latent extractor union behavior on asymmetric codecs (Mongo + SQL).** Whether to enhance both families' `*Input<T>` / `*Output<T>` extractors to return precisely `TInput`/`TOutput` for asymmetric codecs is a follow-up consideration the orchestrator may capture in `user-attention.md`. It does not block any AC; the implementer's tests pin asymmetric expressibility at the method-signature level, which is sufficient evidence of the structural identity.

### M4 R2.9 ADR-shape decisions made at R2 (one architectural decision recorded)

R2 records one decision worth lifting into the m5 ADR:

- **Mongo `MongoCodec` is a structural alias of `BaseCodec`, not a syntactically extended type.** SQL's `Codec` extends `BaseCodec` with `meta`/`paramsSchema`/`init`/`TParams`/`THelper` because the SQL family genuinely needs those extras (parameterized codecs, init hooks). The Mongo family currently has no equivalent need. Aliasing rather than extending keeps `MongoCodec` exactly equivalent to `BaseCodec` at the type level, which is the simplest possible expression of "the cross-family contract is at `BaseCodec`." Any future Mongo-specific extras would be added by changing the alias to an `extends` declaration — an additive change with a clear migration path.

### M4 R2.10 Independent re-verification (post-artifact-commit)

A second-pass reviewer independently re-verified the m4 R2 narrative above against on-disk state at HEAD `0d7bd780b` (the artifact-commit). The new orchestrator delegation cited HEAD `47ce86a6f` (the implementation HEAD), one commit prior to the artifact-commit; the second pass reconciled this snapshot drift by re-running every validation gate and re-inspecting every cited source file rather than re-doing the already-committed review.

- **Source state — concordance confirmed.** [`packages/2-mongo-family/6-transport/mongo-lowering/README.md (L7)`](../../../packages/2-mongo-family/6-transport/mongo-lowering/README.md:7), [`packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts (L5)`](../../../packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts:5), [`packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts (L30–L98)`](../../../packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts:30-98), and [`packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts (L65–L112)`](../../../packages/2-mongo-family/1-foundation/mongo-codec/test/codecs.test-d.ts:65-112) all match the M4 R2.1–R2.9 narrative bit-for-bit.
- **Validation gates — green at HEAD `0d7bd780b`.** All 14 gates listed in [code-review.md § m4 — Round 2](code-review.md) re-ran fully green (mongo-codec 18/18 typecheck+test; adapter-mongo 215/215; target-mongo 366/366; mongo-contract 76/76; mongo-lowering types-only typecheck PASS; cross-family-codec 3/3; workspace typecheck 120/120; test:packages 111/111; test:integration 104 files / 521 tests; lint:deps 606 modules / 1198 deps no violations). No drift; CAS flake did not reproduce.
- **No new findings; no AC-scoreboard movement.** AC-CX1 strictly PASS confirmed; the M4 R2.5 risk register and M4 R2.8 open-questions register stand unchanged.
- **Stale-snapshot disposition.** The orchestrator's delegation prompt assumed HEAD `47ce86a6f`. Treated as audit-trail noise (the implementation HEAD vs the artifact-commit HEAD), not as a finding.

This subsection is informational; it does not alter any of M4 R2.1–R2.9.

## M5 R1 — security tests, ADR 204, supersession pointer, README sweep (final architectural snapshot)

> **Scope.** Reflects HEAD `5ac4a3de6`. m5 R1 is **ANOTHER ROUND NEEDED** ([code-review.md § m5 — Round 1](code-review.md)) — four doc / test-comment-quality findings (F5, F6, F7 from the first reviewer pass; F8 added by the second-pass reviewer for the T5.4 deferred-test header comment overpromising) are blocking. AC substance for the seven m5 ACs is complete and clean; this section captures the final architectural snapshot for the project as a whole.

### M5.1 Final architectural snapshot — what the system looks like at the close of m1..m5

This subsection is the final architectural snapshot the project commits the system to. It is independent of F5/F6/F7 (those are doc-quality defects against the canonical-but-not-yet-pristine artifacts that record this snapshot).

#### M5.1.1 Public surface

The public codec contract is structurally identical at the `BaseCodec` seam in both the SQL and Mongo families:

```ts
// packages/1-framework/1-core/framework-components/src/codec-types.ts
interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
  TOutput = TInput,
> {
  readonly id: Id;
  readonly targetTypes: readonly string[];
  readonly traits?: TTraits;
  encode(value: TInput): Promise<TWire>;
  decode(wire: TWire): Promise<TOutput>;
  encodeJson(value: TInput): JsonValue;
  decodeJson(json: JsonValue): TInput;
  renderOutputType?(typeParams: Record<string, unknown>): string | undefined;
}
```

- **Family extensions.** `relational-core`'s SQL `Codec` extends `BaseCodec` with `meta`/`paramsSchema`/`init`/`TParams`/`THelper` (parameterized codecs + init hooks). `mongo-codec`'s `MongoCodec` aliases `BaseCodec` directly (5 generics, same order, same defaults). The cross-family seam is at `BaseCodec<Id, TTraits, TWire, TInput, TOutput>`.
- **One factory per family, sync-or-async authoring.** `codec()` (SQL) and `mongoCodec()` (Mongo) both accept author-supplied `encode` / `decode` as sync or async; the factory uniformly lifts to Promise-returning at the boundary via `async (x) => fn(x)`. Build-time `encodeJson` / `decodeJson` / `renderOutputType?` stay synchronous and pass through unchanged.
- **No async marker on the public surface.** No `runtime` field, no `kind` discriminant, no `TRuntime` generic, no `codecSync` / `codecAsync` factory variants, no `isSyncEncoder` / `isSyncDecoder` predicates, no conditional return types. ADR 204 § Walk-back framing transcribes the seven NFR #5 walk-back constraints verbatim and the codebase satisfies all seven (verified across m1..m5 by grep audits and type-test pinning).

#### M5.1.2 Runtime shape

Both family runtimes (SQL fully; Mongo encode-side; Mongo decode-side intentionally out of project scope) follow the same single-path pattern:

- **One `encodeParams` and one `decodeRow` / `decodeField`.** No sync-vs-async branches; the runtime always-awaits.
- **`Promise.all` concurrent dispatch over per-row work.** `encodeParams` collects per-parameter codec calls into a `tasks` array and `Promise.all`s them; `decodeRow` does the same per-cell. Sync-authored codecs incur one microtask of overhead per call; async-authored codecs run truly concurrent.
- **Plain-`T` semantics through to user code.** Awaited cells reach `Collection.first()` / `for await ... of c.all()` / write-surfaces (`CreateInput` / `MutationUpdateInput`) as plain `T`, never as `Promise<T>`. Pinned at the type level with `IsPromiseLike<…> = false` negative assertions in `codec-async.types.test-d.ts`; pinned at the runtime level with `.not.toBeInstanceOf(Promise)` integration assertions against live Postgres.
- **Standard error envelope with `cause` chaining.** `RUNTIME.ENCODE_FAILED` and `RUNTIME.DECODE_FAILED` carry `{label, codec, paramIndex}` / `{table, column, codec}` and the original error chained on `cause`. Codec-authored `error.message` interpolation point is preserved (redaction-spelling is out of scope per [`spec.md` § Non-goals (L92)](../spec.md)).
- **JSON-Schema validation runs against the resolved decoded value.** Per AC-RT7, `validateJsonValue` is invoked after `await codec.decode(...)`. Failure shape is `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED`. Pinned by tests at both the unit level (m2 R1 + m5 T5.3) and the integration level.
- **Build-time methods stay sync.** `validateContract` (SQL) / `validateMongoContract` (Mongo) and `postgres({...})` / `createMongoAdapter()` retain synchronous return types. Type + runtime regressions (m2 T2.10 / m4 T4.10) lock this in.

The Mongo adapter additionally:

- **`MongoAdapter.lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand>`** — the `lower()` boundary returns `Promise<…>` so adapters can run async codec encodes (via `resolveValue`) before producing the wire shape. Documented at `packages/2-mongo-family/6-transport/mongo-lowering/README.md` and `packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts`.
- **`resolveValue` recursively resolves param refs through codec encodes**, walking object children and array elements with `Promise.all` for concurrent dispatch.
- **Mongo decode-side is intentionally out of project scope** — Mongo doesn't decode rows today; adding row decoding would invent a new subsystem orthogonal to async codecs. ADR 204 records this as the natural next-project boundary, with a note that future Mongo row decoding should mirror SQL's `decodeRow` pattern (single-armed dispatch, `Promise.all` per-cell, await before yield).

#### M5.1.3 Cross-family parity

- **Strict structural identity at the `BaseCodec` seam.** A single `codec({...})` value with asymmetric `TInput ≠ TOutput` types is structurally usable in both family registries, post-m4 R2 widening. AC-CX1 strict reading is satisfied.
- **Cross-family integration test ([`test/integration/test/cross-package/cross-family-codec.test.ts`](../../../test/integration/test/cross-package/cross-family-codec.test.ts), 3/3 PASS in `pnpm test:integration`)** demonstrates: a single SQL `codec({...})` value registered in both family registries, byte-equal encode wire output across both registries, Mongo encode through `resolveValue` matching SQL `codec.encode()` output, SQL decode round-trips.
- **Encode-side runtime pattern parity.** Both SQL and Mongo encode paths await before consuming and use `Promise.all` for concurrency; the same pattern would extend to Mongo decode if and when that work lands.

#### M5.1.4 ADR canon

- **ADR 204 — Single-Path Async Codec Runtime** (`docs/architecture docs/adrs/ADR 204 - Single-Path Async Codec Runtime.md`) is born in canonical location and captures: Context (rejected per-codec-marker design), Decision (single-path always-await + uniform Promise-returning interface + single factory per family), Architecture (interface shape, factory lift mechanic, runtime always-await + `Promise.all`, cross-family parity at the `BaseCodec` seam, walk-back framing with the seven NFR #5 constraints), Trade-offs, Cross-family scope notes (Mongo decode out of scope), and References.
- **ADR 030 — Result decoding & codecs registry** carries a partial-supersession pointer at line 3 naming the codec method signatures (query-time), Decoding pipeline section, and Streaming and cursors clause as superseded by ADR 204; the registry model, lookup precedence, traits semantics, and error-envelope shape remain authoritative. F7 (low / process) flags the imprecision of the supersession's listing of the build-time `encodeJson` / `decodeJson` methods alongside the query-time methods; the substance of the pointer is correct.
- **ADR 184 — Codec build-time JSON bridge** (referenced by ADR 204) is unchanged; the build-time bridge to `JsonValue` is the long-standing seam preserved by the single-path design.
- **No ADR links to transient `projects/codec-async-single-path/**` or `wip/review-code/pr-375/**`** — both are excluded by the always-applied `doc-maintenance` rule.

### M5.2 Subsystem fit (final)

#### M5.2.1 Authoring (codec interface and factory) — m1 contribution, refreshed

The codec interface is the single public seam between codec authors and the runtime. m1's reshape to 5 generics with `TOutput = TInput` default + Promise-returning query-time methods is preserved end-to-end through m2..m5; ADR 204 documents this as the authoritative design. The factory accepts sync-or-async author functions transparently — authors don't have to know about the async lift — and the JSDoc-level documentation explicitly frames the author surface as "you may write sync or async; the factory lifts uniformly". This is one of the seven walk-back constraints (NFR #5 #6: "no docs that frame author choice in sync-vs-async terms"), satisfied throughout.

#### M5.2.2 SQL runtime — m2 contribution, refreshed

`encodeParams` and `decodeRow` / `decodeField` are single-armed and Promise-aware. `Promise.all` over per-parameter and per-cell tasks gives concurrent dispatch. `wrapEncodeFailure` / `wrapDecodeFailure` produce well-shaped envelopes with `cause` chaining. JSON-Schema validation runs against the awaited decoded value. The encode and decode hot paths await before yielding so the streaming generator returns plain-`T` rows. Build-time `validateContract` and `postgres({...})` stay sync (regression-locked at the type and runtime levels). The seeded-secret-codec fixture (m5 T5.5) exercises the full async crypto round-trip end-to-end through both encode and decode.

#### M5.2.3 ORM client types — m3 contribution, refreshed

`DefaultModelRow` / `InferRootRow` carry plain `T` for codec-decoded fields through both the one-shot (`Collection.first()`) and streaming (`for await ... of c.all()`) paths. Write surfaces (`CreateInput` / `MutationUpdateInput` / `UniqueConstraintCriterion` / `ShorthandWhereFilter`) accept plain `T`. There is **one** field type-map shared between read and write surfaces (no read/write split). 21 type tests in `test/codec-async.types.test-d.ts` pin every read+write field position to plain `T` with `IsPromiseLike<…> = false` negative assertions; runtime-level integration tests assert `.not.toBeInstanceOf(Promise)` on every codec-decoded cell value yielded by both read paths against live Postgres.

#### M5.2.4 Mongo cross-family parity — m4 R1 + R2 contribution, refreshed

Encode-side: `MongoAdapter.lower()` returns `Promise<AnyMongoWireCommand>`; `resolveValue` recursively walks objects and arrays with `Promise.all` for concurrent codec encodes; codec-encoded `MongoParamRef` values round-trip through the lowering chain. Decode-side: intentionally out of project scope. `MongoCodec` aliases `BaseCodec` exactly with 5 generics; cross-family seam is at `BaseCodec<Id, TTraits, TWire, TInput, TOutput>`. SQL `Codec` and Mongo `MongoCodec` are mutually substitutable at the `BaseCodec` shape; asymmetric `TInput ≠ TOutput` codecs are expressible on both sides. Build-time `validateMongoContract` and `createMongoAdapter()` stay sync (regression-locked).

#### M5.2.5 Security tests — m5 contribution

The PR #375 security-tests translation is complete on the in-scope axes:

- **Envelope shape with `cause` (AC-SE1).** Verified at the runtime level (`wrapEncodeFailure` / `wrapDecodeFailure`) and end-to-end through the seeded-secret-codec fixture.
- **JSON-Schema validation against the resolved value (AC-SE4 JSON-Schema piece).** A failing async-decoder validator surfaces as `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` with the resolved value, not a Promise. New test in m5 T5.3.
- **Seeded-secret-codec end-to-end (AC-SE3).** Async crypto encrypt-on-encode, decrypt-on-decode, no Promise-typed cells reach user code, decode failures wrap cleanly. New fixture and test in m5 T5.5.
- **Validator-message redaction (AC-SE2) — `it.skip` deferral.** Spec-legitimate per § Non-goals; assertion preserved verbatim in `it.skip` form for activation by a future redaction-spelling project.
- **Include-aggregate child-row decoding (AC-SE4 include-aggregate piece) — `it.skip` deferral × 3.** "Concrete blocker" deferral: the dispatcher does not invoke codecs on `jsonb_agg` child cells today (verified by `rg`); adding this is new ORM feature work outside this project's async-shape scope. PR #375's promise-valued child-cell test is **dropped** because asserting `Promise`-typed child cells contradicts AC-RT2's plain-`T` guarantee.

The four `it.skip` blocks are documented inline (header JSDoc with rationale and follow-up pointer), and they appear in `pnpm test:packages` output as four expected skips.

### M5.3 Boundary correctness (final)

- **Public boundary at `Codec.encode` / `Codec.decode`.** Always Promise-returning. No author of an external codec needs to know about the async lift; the factory transparently handles both shapes.
- **Build-time boundary at `validateContract` / `validateMongoContract` / `postgres({...})` / `createMongoAdapter`.** Synchronous. Regression-locked by m2 T2.10 + m4 T4.10 type + runtime tests.
- **Runtime-to-user-code boundary at `Collection.first()` / `for await ... of c.all()`.** Plain `T` (or `T | null` for nullable codec fields). No `Promise`-typed cells ever reach user code; this is the central single-path guarantee.
- **Cross-family registration boundary at `MongoCodecRegistry.register(codec)` / SQL codec registry.** Both registries accept the same 5-generic `BaseCodec` shape; a single codec value is structurally usable in both.
- **Adapter-level boundary at `MongoAdapter.lower(plan)`.** `Promise<AnyMongoWireCommand>` — adapters await before consuming, allowing async codec encodes to run before the wire shape is produced.
- **Out-of-project boundary at Mongo row decoding.** Not part of this project; ADR 204 records the future-design pattern (mirror SQL's `decodeRow`) and the natural next-project entry point.

### M5.4 Risks (final)

- **F5 (should-fix).** ADR 204 declares a fictional `Codec` interface signature in two places (§ Decision item 1 and § Architecture code block). Generic list and member types do not match the actual interface in `framework-components/src/codec-types.ts`. Localized doc fix in m5 R2.
- **F6 (should-fix).** Six factory examples across ADR 204, `relational-core/README.md`, and `mongo-codec/README.md` use `id:` instead of the correct `typeId:` config key — examples are non-compilable. Localized doc fix in m5 R2.
- **F7 (low / process).** ADR 030's supersession pointer over-claims by listing build-time `encodeJson` / `decodeJson` alongside query-time `encode` / `decode` as superseded; the build-time methods remain synchronous in ADR 204. Localized doc fix in m5 R2.
- **F8 (should-fix, second-pass reviewer addition).** The T5.4 deferred-test header comment in [`packages/3-extensions/sql-orm-client/test/collection-dispatch.test.ts (L395–L420)`](../../../packages/3-extensions/sql-orm-client/test/collection-dispatch.test.ts:395-420) claims the assertions are "preserved verbatim against the single-path contract", but the three `it.skip` bodies carry only `expect(true).toBe(true)` stubs. The deferral is sound (child-row codec decoding is orthogonal ORM work outside async-shape scope; AC-SE4 stays PASS-with-scope-note); the artifact's documentation contradicts what's on disk. T5.2's deferral at [`json-schema-validation.test.ts (L613–L661)`](../../../packages/2-sql/5-runtime/test/json-schema-validation.test.ts:613-661) demonstrates the deferred-test discipline correctly (full assertion shape preserved); T5.4 should match that shape (Option A — preserve the assertion shape from PR #375 inside the `it.skip` bodies) or correct the comment (Option B). Localized fix in m5 R2.
- **All F5/F6/F7/F8 are doc / test-comment-quality defects.** None affect source code, none affect type-correctness of the implementation, none invalidate test coverage. The substance of ADR 204 (single-path always-await, build-time vs query-time seam, cross-family parity, walk-back framing) is sound and correctly stated in prose; the defects are localized to specific code blocks, prose listings, and one deferred-test header comment inside otherwise-correct artifacts.
- **Pre-existing `MongoMigrationRunner` CAS flake (carryover from m4).** Out of project scope. Reviewer-side did not reproduce in m5 R1. Recommend the orchestrator log a separate follow-up issue for migration-runner robustness.
- **Include-aggregate child-codec dispatch (orchestrator follow-up).** Orthogonal new ORM feature surfaced by m5 T5.4's `it.skip` placeholders. Recommend the orchestrator capture this as a separate follow-up project (`orm-include-aggregate-codec-dispatch` or similar) and surface it in `user-attention.md`.
- **Latent extractor union behavior on asymmetric codecs (carryover from m4 R2).** Pre-existing SQL behavior that Mongo mirrors per the strict-parity mandate; not blocking; surfaced in `user-attention.md` as informational.

### M5.5 Test strategy adequacy (final)

- **Unit + type tests at every layer.** `pnpm test:packages` runs 111 tasks workspace-wide; all pass with 4 documented `it.skip` blocks (m5 T5.2, m5 T5.4 × 3) accounted for.
- **Integration tests against live Postgres (and live Mongo where available).** `pnpm test:integration` runs 104 files / 521 tests; cross-family-codec roundtrip exercises both registries against the same codec value.
- **Type-level pinning at every public boundary.** 21 ORM type tests for plain-`T` semantics; type tests pinning the `Codec` / `MongoCodec` 5-generic shape; type tests pinning `validateContract` / `validateMongoContract` / `postgres` / `createMongoAdapter` synchronous return types; type tests pinning the cross-family `BaseCodec` structural identity.
- **Walk-back constraints tested.** Each of the seven walk-back constraints from NFR #5 has a corresponding negative test or grep audit (zero matches for `runtime` field on `Codec` interface, zero matches for `codecSync`/`codecAsync`, zero matches for `isSyncEncoder`/`isSyncDecoder`, conditional return types absent from `encode`/`decode` signatures, exactly five generics on both `Codec` and `MongoCodec`, JSDoc framing of author choice as "sync or async", build-time methods regression-locked to sync). ADR 204's walk-back framing transcribes the seven constraints verbatim.
- **Adversarial / security tests.** Seeded-secret-codec exercises a real crypto path (AES-GCM with deterministic test key) end-to-end through encode + decode; envelope `cause` chaining preserves the original error so security telemetry can recover it; JSON-Schema validation runs against the awaited decoded value (preventing a class of "Promise leak" exploits where a validator was tricked into treating an unresolved Promise as a structurally-valid object).

### M5.6 Open questions for the create-pr handoff

1. **F5/F6/F7/F8 closure.** Four localized doc / test-comment edits in m5 R2 will close the round. Each is independently small (ADR 204 interface block + Decision listing; six README/ADR `id:` → `typeId:` renames; ADR 030 line-3 listing trim; T5.4 deferred-test header comment alignment with `it.skip` bodies — Option A preserves the assertion shape from PR #375 inside the bodies, Option B corrects the comment to match what's on disk). F5/F6/F7 can land in a single doc-only commit; F8 lands as a separate commit on the test artifact (so the commit history records the deferred-test discipline correction independently of the ADR/README cleanup).
2. **`user-attention.md` items the user should review before close-out.** Three new items surfaced by m5 R1: include-aggregate child-codec dispatch as a follow-up project, PR #375 test 8 dropped (not skipped), T5.11 / T5.12 close-out is queued behind the user's review of `user-attention.md`. The orchestrator owns capture.
3. **Close-out PR sequencing.** The T5.11 / T5.12 work (strip `projects/` references and delete the directory) should land in a separate PR sequenced after the user's `user-attention.md` review, per the orchestrator's mandate. The close-out PR will re-render this SDR and the walkthrough as the project ends.
4. **No spec changes required.** All m5 ACs are PASS or PASS-with-scope-note on substance; no `spec.md` edits are needed to land m5 R2 SATISFIED.

### M5.7 ADR-shape decisions made at m5 (one architectural decision recorded; all others are restatements)

m5 R1 records one architectural decision worth lifting into the ADR canon, beyond what m1..m4 R2 already captured:

- **Mongo decode-side is intentionally out of project scope; future Mongo row decoding should mirror SQL's `decodeRow` pattern.** Captured in ADR 204 § Cross-family scope notes. The single-path always-await, `Promise.all` per-cell concurrency, and await-before-yield invariants are the same on both sides; the next project to extend Mongo with row decoding can adopt the SQL `decodeRow` shape directly.

The remaining architectural decisions in m5 R1's ADR (single-path always-await, build-time vs query-time seam, cross-family parity at `BaseCodec`, walk-back framing) are restatements / consolidations of decisions already implemented and tested in m1..m4 R2. ADR 204's contribution is to record them as canonical for future contributors.

## M5 R2 — F5/F6/F7 doc fixes

> Doc-quality closure round. No architectural deltas; ADR 204 + ADR 030 + two READMEs are now correct on the points F5/F6/F7 flagged. F8 (T5.4 deferred-test header comment vs `it.skip` bodies) was unaddressed in this round and remains open at HEAD `a4aeba917`; surfaced to the orchestrator for an explicit decision (re-delegate to R3 or visibly override).

### M5 R2.1 What changed since m5 R1

A single doc-only commit (`a4aeba917`) closes F5, F6, and F7 with localized edits to four files:

- [`docs/architecture docs/adrs/ADR 204 - Single-Path Async Codec Runtime.md`](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) — § Decision item 1 prose listing now narrates the real build-time signatures (`encodeJson(value): JsonValue`, `decodeJson(json: JsonValue): TInput`, `renderOutputType(typeParams): string | undefined`); § Architecture › `Codec` interface shape carries the verbatim source-of-truth interface from [`framework-components/src/codec-types.ts:27-50`](../../../packages/1-framework/1-core/framework-components/src/codec-types.ts:27-50) (5 generics — `Id, TTraits, TWire, TInput, TOutput=TInput`; correct method signatures; no fictional `TJson` / `TJsonInput` / `TypeNode`); § Architecture factory examples renamed `id:` → `typeId:` for `textCodec` and `secretCodec`. **F5 + F6 closed in this file.**
- [`packages/2-sql/4-lanes/relational-core/README.md`](../../../packages/2-sql/4-lanes/relational-core/README.md) — `textCodec` and `secretCodec` examples renamed `id:` → `typeId:`. **F6 closed.**
- [`packages/2-mongo-family/1-foundation/mongo-codec/README.md`](../../../packages/2-mongo-family/1-foundation/mongo-codec/README.md) — `intCodec` and `secretCodec` examples renamed `id:` → `typeId:`. **F6 closed.**
- [`docs/architecture docs/adrs/ADR 030 - Result decoding & codecs registry.md`](../../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md) — supersession pointer at L3 trimmed to "the codec query-time method signatures (synchronous `encode` / `decode`)"; build-time `encodeJson` / `decodeJson` no longer appear in the listing. **F7 closed.**

The fix also corrects a peripheral defect noted in passing in m5 R1: ADR 204 § Decision item 1 had `decodeJson(json: JsonValue): TOutput` (the real return type is `TInput`); the implementer corrected it to match the source-of-truth.

### M5 R2.2 Architectural snapshot at HEAD `a4aeba917`

No change from m5 R1's snapshot. The architectural shape — single-path always-await, build-time vs query-time seam, cross-family parity at the `BaseCodec` seam, walk-back framing — is unchanged; the only deltas are doc-quality alignment between ADR canon and source-of-truth.

ADR 204's `Codec` interface block is now diff-clean against `framework-components/src/codec-types.ts:27-50` (presentational differences only — JSDoc presence in source, top-level vs in-block `import type { JsonValue }`). Future drift can be guarded by a CI hook that diffs the ADR block against the source file; not adopted in m5 R2 (out of scope), but recorded as an option for the close-out PR or a follow-up if the doc-source drift recurs.

### M5 R2.3 F8 status (open at end of m5 R2)

F8 was filed by the second-pass reviewer in m5 R1 against the T5.4 deferred-test header comment in [`collection-dispatch.test.ts (L405–L406)`](../../../packages/3-extensions/sql-orm-client/test/collection-dispatch.test.ts:405-406). The header comment claims "the assertions themselves are preserved verbatim against the single-path contract", but the three `it.skip` bodies at [L426](../../../packages/3-extensions/sql-orm-client/test/collection-dispatch.test.ts:426), [L430](../../../packages/3-extensions/sql-orm-client/test/collection-dispatch.test.ts:430), and [L434](../../../packages/3-extensions/sql-orm-client/test/collection-dispatch.test.ts:434) carry only `expect(true).toBe(true)` stubs. The orchestrator's R2 delegation prompt to the implementer enumerated only F5 / F6 / F7; F8 was not in their scope. The implementer correctly executed the assigned worklist; F8 remains as it was at end of m5 R1.

The reviewer's findings discipline ([`.agents/skills/drive-orchestrate-plan/SKILL.md`](../../../.agents/skills/drive-orchestrate-plan/SKILL.md) § "Findings discipline") requires the findings log to be empty of opens for a phase SATISFIED verdict; F8 therefore blocks SATISFIED. Two paths forward (orchestrator's call): re-delegate F8 to an R3 implementer with a one-task worklist (Option B preferred — one-comment edit at [`collection-dispatch.test.ts (L403–L406)`](../../../packages/3-extensions/sql-orm-client/test/collection-dispatch.test.ts:403-406); Option A — preserve PR #375 assertion shapes inside the `it.skip` bodies — preferred for deferred-test-discipline preservation), or visibly override F8 with an explicit recorded rationale per § Loop algorithm step 7 of the SKILL.

### M5 R2.4 Validation gates

Workspace-wide light gates re-run after the doc fixes:

| Gate | Command | Result | Notes |
|---|---|---|---|
| Layering / imports | `pnpm lint:deps` | PASS (0 violations across 606 modules / 1198 deps) | Sanity check after doc-only edits. |
| Type-check | `pnpm typecheck` | PASS (120/120 tasks) | Sanity check that codeblock-extracted code in ADR 204 stays syntactically valid; the new `Codec` interface block is verbatim source-of-truth so any type-level issue would surface in `framework-components` first. |

`pnpm test:packages` / `pnpm test:integration` / `pnpm test:all` were skipped per the round prompt — R2 is doc-only and the m5 R1 test results carry forward unchanged.

### M5 R2.5 AC scoreboard delta

- **AC-DW1** (ADR 204 documents single-path design / seam / cross-family / walk-back; ADR 030 has supersession pointer): `PASS — substance complete; F5/F6/F7 are doc-quality findings inside the canonical artifacts` → **PASS unconditionally**. F5/F6/F7 closed by `a4aeba917`.
- All other ACs unchanged from m5 R1.

**Totals at end of m5 R2: 26 PASS / 0 FAIL / 0 NOT VERIFIED** (with three PASS-with-scope-note entries on AC-SE2, AC-SE4, AC-DW3 — all unchanged from m5 R1).
