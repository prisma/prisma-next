# Summary

Add asynchronous codec support to Prisma Next via a single-path runtime: codec query-time methods (`encode`, `decode`) are uniformly `Promise`-returning at the public boundary, the runtime always awaits, and the codec factory transparently lifts synchronous author functions. Build-time methods (`encodeJson`, `decodeJson`, `renderOutputType`) stay synchronous so `validateContract` and client construction remain sync. The synchronous fast path is preserved as a future, additive opt-in.

# Description

The codec runtime today is purely synchronous: every codec method runs on the call stack of the query that invoked it, and rows are assembled out of plain values. A small but real class of codecs needs asynchronous work — KMS-resolved encryption keys, externally-resolved secrets, deferred reference lookups, secret rotation. These are minority cases, but concrete enough that the runtime needs to accommodate them.

[PR #375](https://github.com/prisma/prisma-next/pull/375) attempted to add async support via a per-codec opt-in: a `runtime` flag on the public `Codec` interface, a `TRuntime` generic, conditional return types on `encode` / `decode`, a dual-path SQL runtime, and a read/write type-map split in the ORM client. The architectural review (the [rejecting code review response](../../wip/review-code/pr-375/code-review-response.md) and companion [single-path design](../../wip/review-code/pr-375/alternative-design.md), posted to PR #375) rejected that direction in favor of a single-path design that:

- Localizes the cost of supporting both sync and async codecs to **one place** (the runtime's two codec invocation loops), not the public interface, the type system, or consumer-facing types.
- Lands cleanly on the structural seam between **query-time** (per-row, IO-relevant) and **build-time** (per-contract-load, sync) methods.
- Preserves a **two-way door** to a synchronous fast path as a non-breaking, additive opt-in (`codecSync()` + predicates) when sustained-throughput workloads require it.

This project implements that single-path design end-to-end on a fresh branch cut off `main`. It does **not** carry over the async runtime parts of PR #375; it does carry over (translated) the security/redaction work and test fixtures, which are independent of the async-shape decision.

# Requirements

## Functional Requirements

1. **Codec authors write either sync or async query-time functions, with no annotations.**
   - Sync example: `codec({ id: 'pg/text@1', targetTypes: ['text'], encode: (v) => v, decode: (w) => w, encodeJson: (v) => v, decodeJson: (j) => j as string })`.
   - Async example: same shape with `encode: async (v) => encrypt(v)`, `decode: async (w) => decrypt(w)`.
   - The factory accepts both forms; the constructed `Codec` exposes Promise-returning query-time methods either way. `encode` may be omitted (identity default).

2. **The public `Codec` interface is uniform across codecs.**
   - `encode` and `decode` are required and Promise-returning at the public boundary.
   - `encodeJson` and `decodeJson` are required and synchronous.
   - `renderOutputType` is optional and synchronous.
   - There is no per-codec async marker, no `TRuntime` generic, and no conditional return type on the public interface.

3. **The runtime always awaits codec work; rows yield plain values.**
   - `encodeParams` is async and dispatches all parameter codecs concurrently via `Promise.all`.
   - `decodeRow` is async and dispatches all field codecs concurrently via `Promise.all`.
   - `decodeField` is single-armed: call codec → await → run JSON-Schema validation on the resolved value → return plain value.
   - Rows yielded to user code (one-shot `.first()` / `.all()` and streaming via `AsyncIterableResult`) have plain field values; no `Promise`-typed fields reach user code.

4. **ORM client type surfaces are uniform.**
   - `DefaultModelRow` / `InferRootRow` field types are plain `T`, regardless of which codec produced the value.
   - Write surfaces (`MutationUpdateInput`, `CreateInput`, `UniqueConstraintCriterion`, `ShorthandWhereFilter`, `DefaultModelInputRow`) accept plain `T`.
   - Read and write surfaces share **one** field type-map.

5. **`validateContract` and client construction stay synchronous.**
   - `validateContract<Contract>(contractJson)` returns synchronously.
   - `postgres({...})` and equivalent client constructors remain sync.
   - Build-time `decodeJson` / `encodeJson` are not awaited anywhere in the load path.

6. **Codecs are portable across SQL and Mongo families.**
   - The Mongo `Codec` interface is the same shape as the SQL `Codec` interface (same generic parameters, same Promise-returning query-time methods, same synchronous build-time methods, same factory entry point).
   - A single `codec({...})` value is structurally usable in both SQL and Mongo runtimes.
   - On the **encode** side (where Mongo invokes codecs today via `resolveValue` → `MongoAdapter.lower()`), the runtime always-awaits, mirroring the SQL pattern. The `Promise.all`-style concurrency analog applies: when a value tree contains multiple codec-encoded leaves, they dispatch concurrently rather than serially.
   - On the **decode** side: Mongo's runtime does not currently decode rows — documents pass through from the driver directly. Adding a Mongo decode path is out of scope for this project (see Non-goals).

7. **Encode/decode failures are wrapped in the standard error envelope.**
   - Encode failures throw `RUNTIME.ENCODE_FAILED` with `{ label, codec, paramIndex }` and the original error on `cause`.
   - Decode failures throw `RUNTIME.DECODE_FAILED` with `{ table, column, codec }` and the original error on `cause`.
   - Codec error message redaction policy is preserved (cause routing, bounded `wirePreview`, validator-message redaction trigger).

8. **Security work from PR #375 translates and lands.**
   - Envelope redaction for codec error messages is exercised by tests against the new runtime.
   - Validator-message redaction is exercised by tests.
   - `seeded-secret-codec` fixture exists and exercises a realistic crypto path end-to-end against the new runtime.
   - JSON-Schema failure shape and include-aggregate test patterns translate.

## Non-Functional Requirements

1. **Per-row microtask cost is O(1).** `encodeParams` and `decodeRow` use `Promise.all` to dispatch cell codecs concurrently; resumption happens on a single microtask tick after the last cell settles. This holds for both sync-lifted and genuinely async codecs.

2. **Per-cell allocation overhead is one Promise.** Acceptable for the current scale and decode-work envelope. The future sync fast-path opt-in eliminates this for the codecs that adopt it.

3. **Performance assumptions are documented, not benchmarked.** No microbenchmark suite is in scope. The assumptions are stated up front in the [design doc](../../wip/review-code/pr-375/alternative-design.md#performance-assumptions); reviewers can stress-test them once.

4. **Type-checking time is net-neutral or improved** vs. the PR #375 shape. The single-path interface has fewer generic parameters and no conditional return types. (No measurement gate; tracked qualitatively.)

5. **Walk-back constraints are preserved.** The design today must not lock in any of:
   - A sync/async marker on the public `Codec` interface (no `runtime`, `kind`, or equivalent field).
   - Multiple factory variants (`codecSync` / `codecAsync`).
   - Exported sync-vs-async predicates.
   - Conditional return types tied to async-ness on the public interface.
   - A `TRuntime` generic on `Codec`.
   - Documentation framing the author surface as "codec functions return Promises" (instead: "you may write sync or async; the factory accepts both").
   - Public guarantees that depend on async-ness (e.g., "errors arrive via promise rejection" instead of "errors are wrapped in the standard envelope").

## Non-goals

- **Sync fast-path opt-in (`codecSync()` + `isSyncEncoder()` / `isSyncDecoder()` predicates).** Deferred to a future, additive PR when production workload makes it load-bearing.
- **Async build-time methods** (`encodeJson`, `decodeJson`, `renderOutputType`). Out of scope; build-time path stays synchronous. The same factory-lift technique extends if a future codec needs it.
- **Async `validateContract` / async client construction.** Out of scope; would be a wider blast radius than this project should carry.
- **Microbenchmark suite for per-cell decode overhead.** Out of scope; assumptions are documented and reviewer-checkable against V8 design docs.
- **Bun/JavaScriptCore verification of fast-async equivalence.** Out of scope; design assumes parity, walk-back is the answer if measurement says otherwise.
- **Adding a Mongo decode path.** Mongo's runtime does not decode rows today; introducing one (projection-aware document walker, async dispatch, result-shape decisions) is a substantial piece of work orthogonal to async codecs and out of scope here.
- **Changes to the redaction-trigger spelling itself.** The redaction policy is preserved as-is; the trigger spelling is independent of the async-shape decision and tracked separately.
- **Carrying over PR #375's async-runtime machinery** (`runtime` flag, `TRuntime` generic, plan-walker, `WeakMap` cache, `instanceof Promise` defensive guard, Mongo type-pin). This project starts from `main`.

# Acceptance Criteria

## Codec interface and factory

- [ ] The public `Codec` interface in `framework-components` has `encode(value): Promise<TWire>` and `decode(wire): Promise<TOutput>`, both required, with `encodeJson`, `decodeJson` synchronous and required, and `renderOutputType` synchronous and optional.
- [ ] The interface has no per-codec async marker (no `runtime`, `kind`, or equivalent field) and no `TRuntime` generic.
- [ ] There is exactly one factory function, `codec()`, exported from `relational-core`. It accepts `encode` and `decode` in either sync or async form. `encode` may be omitted (identity default); `decode` is required.
- [ ] A codec author can write `codec({ ..., encode: (v) => v, decode: (w) => w, encodeJson, decodeJson })` with sync functions and have it work end-to-end through the runtime; replacing the query-time functions with `async` versions also works without further changes.

## Runtime

- [ ] The SQL runtime has exactly one encoding path (`encodeParams`) and one decoding path (`decodeRow` / `decodeField`); both are async and dispatch codec work concurrently via `Promise.all`.
- [ ] Rows yielded by the runtime have plain field values. No `Promise`-typed fields reach user code (verified at the type level and in runtime tests).
- [ ] `validateContract` is synchronous (verified by a regression test).
- [ ] `postgres({...})` (and equivalent client constructors) remains synchronous (verified by a regression test).
- [ ] Encode failures throw `RUNTIME.ENCODE_FAILED` with `{ label, codec, paramIndex }` and original error on `cause`.
- [ ] Decode failures throw `RUNTIME.DECODE_FAILED` with `{ table, column, codec }` and original error on `cause`.
- [ ] JSON-Schema validation runs against the resolved decoded value, not against a Promise.

## ORM client types

- [ ] `DefaultModelRow` / `InferRootRow` exposes plain `T` for codec-decoded fields, in both one-shot (`.first()`, `.all()`) and streaming (`for await` over `AsyncIterableResult`) usage.
- [ ] Write surfaces (`MutationUpdateInput`, `CreateInput`, `UniqueConstraintCriterion`, `ShorthandWhereFilter`, `DefaultModelInputRow`) accept plain `T`.
- [ ] The ORM client uses **one** field type-map covering both input and output sides (no read/write split for codec output types).

## Cross-family parity

- [ ] The Mongo `Codec` interface (in `mongo-codec`) is structurally identical to the SQL one: same generic parameters, same Promise-returning query-time methods, same synchronous build-time methods.
- [ ] A test imports a single `codec({...})` module and exercises it against both the SQL and Mongo runtime fixtures with identical results.
- [ ] `resolveValue` is async and dispatches codec-encoded leaves concurrently via `Promise.all`.
- [ ] `MongoAdapter.lower()` is async; the `MongoAdapter` interface in `mongo-lowering` reflects this.
- [ ] `MongoRuntime.execute()` awaits `adapter.lower(plan)`; encoded wire commands flow into the driver as before.

## Security and error handling

- [ ] An async codec failure produces the standard envelope; the codec's original error is on `cause` and not in the envelope `message`.
- [ ] Validator-message redaction fires when triggered (translated from PR #375's tests).
- [ ] The `seeded-secret-codec` fixture exists, exercises a realistic crypto path end-to-end against the new runtime, and is covered by tests.
- [ ] JSON-Schema failure shape and include-aggregate test patterns are translated and pass.

## Documentation and walk-back preservation

- [ ] A new ADR (e.g. *ADR 0NN — Single-Path Async Codec Runtime*) documents: the single-path query-time design; the build-time vs. query-time seam; the cross-family portability requirement; the walk-back framing for the future sync fast path. [ADR 030](../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md) gains a "Superseded by" pointer for the async-runtime parts.
- [ ] None of the walk-back constraints listed in Non-Functional Requirement #5 are introduced by this work.
- [ ] The `wip/review-code/pr-375/` review artifacts are referenced from the ADR (or migrated content) where relevant; project artifacts under `projects/codec-async-single-path/**` are removed at close-out.

# Other Considerations

## Security

- The error redaction policy (cause routing, bounded `wirePreview`, validator-message redaction) is preserved as-is from current behavior. PR #375's improvements in this area translate to this design and are exercised by tests against the new runtime.
- The `seeded-secret-codec` fixture is the canonical realistic-crypto test path; it exercises encryption/decryption via async `encode` / `decode` end-to-end including envelope redaction on failure.
- The redaction-trigger predicate (`shouldRedact`) lives with the redaction policy itself; its concrete spelling is independent of this design and is not modified here.

**Assumption:** Security work from PR #375 (envelope redaction, validator-message redaction, fixture, JSON-Schema failure shape, include-aggregate cases) is portable as test patterns to the new runtime without architectural changes. Confirmed by the rejecting review.

## Cost

- **Heap allocation per cell:** ~one Promise (small object, young-generation GC). For a query returning N rows × M cells, allocation overhead is N × M Promises.
- **Microtask scheduling:** O(1) per row regardless of cell count (via `Promise.all` resumption batching).
- **Latency overhead per row:** one microtask tick plus the codec body work.
- **Sustained-throughput concern:** allocation pressure becomes the dominant cost at scale, particularly for cell-count-dominant codecs (`text`, `int`, `uuid`, similar passthroughs). The future `codecSync()` opt-in eliminates this for the codecs that adopt it. **Assumption:** load-bearing scale is not yet present in production; ship the simpler shape now and layer the optimization on when measurement says it's needed.

## Observability

- Existing error envelopes (`RUNTIME.ENCODE_FAILED`, `RUNTIME.DECODE_FAILED`) carry codec id, alias, and bounded `wirePreview`. No new envelope fields required.
- No new metrics required for this project. (If/when sync fast-path is added, runtime branch counters could be useful but are not in scope here.)

## Data Protection

- No new personal-data handling. The error redaction policy continues to route codec error messages through `cause` and out of the envelope `message` to avoid leaking sensitive plaintext or wire bytes into logs.

## Analytics

- Not applicable.

# References

- [Single-path design (companion to rejecting review)](../../wip/review-code/pr-375/alternative-design.md) — the architectural source of truth for this project; will become an ADR at close-out.
- [Code review response on PR #375](../../wip/review-code/pr-375/code-review-response.md) — the rejecting review explaining why PR #375's direction is being abandoned.
- [PR #375](https://github.com/prisma/prisma-next/pull/375) — the original async-codec PR (rejected for direction; security work and test patterns translate).
- [ADR 030 — Result decoding & codecs registry](../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md) — current ADR; the async-runtime parts will be superseded.
- [V8 fast-async revamp (2018)](https://v8.dev/blog/fast-async) — grounding for the resolved-await microtask-tick claim.

# Open Questions

None. The shaping decisions are resolved:

- **ADR**: write a new ADR (e.g. *ADR 0NN — Single-Path Async Codec Runtime*) that supersedes the async-runtime parts of [ADR 030](../../docs/architecture%20docs/adrs/ADR%20030%20-%20Result%20decoding%20%26%20codecs%20registry.md), with a "Superseded by" pointer at the top of ADR 030 for those parts.
- **Mongo runtime parity**: the encode-side runtime invocation pattern (`resolveValue`, `MongoAdapter.lower()`, `MongoRuntime.execute()`) is reshaped to async + `Promise.all` for consistency with SQL. The decode side is out of scope (Mongo does not decode rows today).
- **Branch and project layout**: single branch `feat/codec-async-single-path`, single project workspace `projects/codec-async-single-path/`. Implementation proceeds milestone-by-milestone with internal review/refine cycles on the same branch; no stacked PRs.
- **PR opening**: deferred until implementation is complete. The spec + plan are committed locally for now.
- **Linear**: not mirrored.

Anything that surfaces during implementation as a real choice gets escalated as a project-level question rather than silently resolved.
