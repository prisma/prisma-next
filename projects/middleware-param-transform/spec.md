# Summary

Promote `beforeExecute` middleware to a **mutable param-transformation seam**: middleware can rewrite the plan's outbound parameter values before encode runs, with access to the per-query `AbortSignal` from [TML-2330](https://linear.app/prisma-company/issue/TML-2330)'s `CodecCallContext`. This unlocks bulk-everything patterns at the framework layer — bulk-encrypt for KMS-backed columns ([TML-2360](https://linear.app/prisma-company/issue/TML-2360)), bulk-sign for audit-stamped columns, bulk-validate for cross-column constraints — without each extension needing a custom plan-walker or growing the codec interface.

The seam is general-purpose infrastructure: **CipherStash is the first concrete consumer, not the owner.**

# Description

[ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) made codec query-time methods uniformly Promise-returning at the per-cell `codec.encode` / `codec.decode` boundary. That works for codecs whose work fits the per-cell shape (a single value transformation), but it has no answer for codecs whose work is **inherently bulk** — KMS-backed encryption being the canonical case. ZeroKMS and similar services operate efficiently only when amortized across many ciphertexts in one network round-trip; per-cell `codec.encode` calls fan out to N independent HTTPS requests, which the runtime today races concurrently but does not coalesce.

The CipherStash team's first attempt at solving this (see the [framework-gaps audit](../../docs/reference/framework-gaps.md) for the full inventory of friction points they hit) was a **microtask-coalescing batcher** inside the codec body itself: every `codec.encode` call enqueues into a shared queue, a microtask flushes the queue with one bulk SDK call, the codec resolves each per-cell promise. This works but is operationally awkward — the codec body owns concurrency control, batch sizing, abort handling, and SDK-specific error attribution, all squeezed into the per-cell dispatch shape.

A cleaner model: let the **plan-walker** (something that already knows the full plan, the column metadata, and the per-query signal) batch the work, then have `codec.encode` run as identity once the batch has produced its outputs. The runtime already has a hook for this — `beforeExecute` middleware — but two things stop it being usable today:

1. **`beforeExecute` is read-only** in the current middleware shape. Middleware can observe the plan and short-circuit, but cannot mutate `ParamRef.value` to replace plaintext with ciphertext.
2. **The middleware context doesn't carry the `AbortSignal`.** The runtime's per-query signal lives on the codec call context (`CodecCallContext.signal`, plumbed by [TML-2330](https://linear.app/prisma-company/issue/TML-2330)), but middleware fires before any codec dispatch and has no equivalent ctx today. A bulk-encrypt middleware that calls `bulkEncrypt({ signal })` needs the signal.

This project closes both gaps. The middleware contract grows a mutable `ParamRefMutator` API (specifically scoped — middleware cannot rewrite arbitrary AST nodes, only outbound parameter values), and a `MiddlewareContext` carries the same `AbortSignal` reference as the codec call context. Once landed, the bulk-encrypt pattern becomes a ~50-line middleware that any extension author can write, without the framework knowing what bulk encryption is.

The same seam supports any "transform outbound params before they're encoded" pattern: signing (each row gets a signature derived from N other column values), audit-stamping (insert auto-populated `last_modified_by` from the runtime's session), cross-column validation, etc. CipherStash's bulk-encrypt is the first consumer; it should not be the only one.

# Requirements

## Functional Requirements

1. **`beforeExecute` middleware can mutate outbound parameter values.**

   Today's middleware contract (rough shape):
   ```ts
   interface SqlMiddleware {
     readonly beforeExecute?: (plan: SqlExecutionPlan) => void | Promise<void>;
   }
   ```
   becomes:
   ```ts
   interface SqlMiddleware {
     readonly beforeExecute?: (
       plan: SqlExecutionPlan,
       ctx: MiddlewareContext,
       params: ParamRefMutator,
     ) => void | Promise<void>;
   }
   ```

   `ParamRefMutator` exposes a typed, scoped mutation surface:
   ```ts
   interface ParamRefMutator {
     /** Iterate every outbound ParamRef the plan currently carries. */
     entries(): IterableIterator<ParamRefEntry>;

     /** Replace a single ParamRef's value with the result of bulk processing. */
     replaceValue(ref: ParamRefHandle, newValue: unknown): void;

     /** Replace many at once (typical for bulk-pattern middleware). */
     replaceValues(updates: Iterable<{ ref: ParamRefHandle; newValue: unknown }>): void;
   }

   interface ParamRefEntry {
     readonly ref: ParamRefHandle;       // opaque handle, identifies the AST node
     readonly value: unknown;            // current value (possibly already mutated by prior middleware)
     readonly codecId: string | undefined;
     readonly column?: SqlColumnRef;     // when the ParamRef can be resolved to a single column
   }
   ```

   The mutator is **scoped**: it can only replace `ParamRef.value` slots, not rewrite SQL, not insert/remove ParamRefs, not modify projection. This bounds blast radius — a misbehaving middleware can produce incorrect *values*, but cannot produce a structurally-different plan.

2. **`MiddlewareContext` carries the per-query `AbortSignal`.**

   ```ts
   interface MiddlewareContext {
     readonly signal?: AbortSignal;
   }
   ```

   Same `signal` reference the runtime's `CodecCallContext` carries (per [TML-2330](https://linear.app/prisma-company/issue/TML-2330)) — middleware authors observe **signal identity** between `beforeExecute(ctx)` and any subsequent codec call within the same `runtime.execute()` invocation.

   Middleware should pre-check `ctx.signal?.aborted` at entry and short-circuit with `RUNTIME.ABORTED { phase: 'beforeExecute' }` before doing work, mirroring the codec dispatch sites' contract.

3. **Mutation timing is well-defined.**

   `beforeExecute` runs **after** the plan is finalized (lowering complete, ParamRefs assigned codec IDs) and **before** any `codec.encode` call. Middleware that mutates a value:
   - Sees the value as it was authored (or as a prior middleware left it).
   - Produces a value that the corresponding codec's `encode` will receive.
   - Cannot produce a Promise — the mutator is synchronous; bulk async work must await *before* calling `replaceValues`.

4. **`afterExecute` and `onRow` middleware also receive the `MiddlewareContext`.**

   Symmetric plumbing — a middleware that wants to forward `ctx.signal` to a downstream observability hook or to a `bulkDecrypt` post-processor needs the signal at every middleware phase, not just `beforeExecute`.

5. **Mongo middleware shape mirrors SQL.**

   The Mongo runtime's middleware contract grows the same `ParamRefMutator`-style API for outbound `MongoParamRef` mutation, scoped to the same "replace values, not structure" boundary. The per-query `MiddlewareContext.signal` plumbing is identical — same framework-level type, same identity guarantee.

6. **Plan-walking utility for ParamRef enumeration.**

   `ParamRefMutator.entries()` is the user-facing API; internally it relies on a plan-walker that returns every ParamRef in canonical order along with the resolved column ref (when available, via the `ProjectionItem.codecId` / similar AST-walked metadata path established in [#393](https://github.com/prisma/prisma-next/pull/393)). This walker is public — extension authors can use it directly via `@prisma-next/sql-relational-core/ast` if they want to inspect a plan without mutating it.

## Non-Functional Requirements

7. **Type safety: the mutator's `newValue` is typed against the codec's `TInput`.**

   `replaceValue(ref, newValue)` infers `newValue`'s expected type from `ref`'s declared codec — middleware authors get a compile-time check that the value they're passing matches what the codec's `encode` will accept. For codecs without inferable `TInput` (legacy codec IDs, dynamic codec assignment), the type falls back to `unknown` and the contract is documented (the middleware is on the hook for runtime correctness).

8. **Backwards compatibility: existing `beforeExecute` signatures still compile.**

   Middleware that takes only the plan (`(plan) => …`) continues to satisfy the new shape via TypeScript bivariance for trailing parameters. The `ctx` and `params` parameters are additive; existing middleware that doesn't reference them is unchanged.

9. **No allocation when no middleware mutates.**

   The mutator is constructed lazily — if no middleware in the chain calls `replaceValue` / `replaceValues`, the runtime never copies the param array. This preserves the bit-for-bit behaviour of today's middleware-free path.

10. **Cooperative cancellation, not termination.**

    Same contract as the codec dispatch sites: when the signal aborts mid-`beforeExecute`, the runtime returns `RUNTIME.ABORTED` promptly via `raceAgainstAbort` (or equivalent), but in-flight middleware bodies that ignore the signal complete in the background. Middleware authors that wrap a network SDK forward `ctx.signal` to that SDK; pure CPU middleware ignores the signal.

## Non-goals

- **No general AST-rewrite middleware.** Middleware can only replace `ParamRef.value` slots. SQL rewriting, projection mutation, plan restructuring stay reserved for the lowering layer or for explicit `beforeCompile` (which already exists for plan-shape transforms).

- **No middleware-driven concurrency control.** Middleware runs sequentially in the order it was registered; if multiple middlewares process the same ParamRefs (e.g. one signs, the other encrypts), they run in chain order. Concurrency-bounding of the codec dispatch fan-out is a separate concern ([framework-gaps G4](../../docs/reference/framework-gaps.md), tracked under TML-2330).

- **No bulk-decode middleware.** Decode-side bulk work uses a different pattern — the codec returns envelope objects ([TML-2360](https://linear.app/prisma-company/issue/TML-2360)) carrying handles, and user code calls bulk-decrypt utilities post-buffering. Middleware doesn't fit the streaming-decode boundary cleanly.

- **No new framework "bulk codec" trait.** The codec interface stays per-cell. Bulk semantics live at the middleware layer, not the codec layer; the codec author surface stays unchanged from the [TML-2330](https://linear.app/prisma-company/issue/TML-2330) baseline.

# Acceptance Criteria

## Mutation surface

- [ ] **AC-MUT1**: `beforeExecute` middleware receives `(plan, ctx, params)` parameters.
- [ ] **AC-MUT2**: `params.entries()` enumerates every ParamRef in the plan in canonical order, returning `{ ref, value, codecId, column? }` records.
- [ ] **AC-MUT3**: `params.replaceValue(ref, newValue)` mutates the plan's stored value for that ParamRef.
- [ ] **AC-MUT4**: `params.replaceValues(updates)` mutates many at once with a single iteration.
- [ ] **AC-MUT5**: A subsequent `codec.encode` call on a mutated ParamRef receives the new value (not the original).
- [ ] **AC-MUT6**: Middleware **cannot** insert / remove ParamRefs, rewrite SQL strings, or modify projection — the mutator API exposes no such capability and the type system enforces this.
- [ ] **AC-MUT7**: Middleware that doesn't call `replaceValue` / `replaceValues` produces a bit-for-bit identical execution to today's plan path.
- [ ] **AC-MUT8**: When no middleware in the chain mutates, the param array is never copied (verified by reference identity in a test).

## Cancellation

- [ ] **AC-ABT1**: `MiddlewareContext.signal` carries the same `AbortSignal` reference passed to `runtime.execute(plan, { signal })` (or `undefined` when no signal supplied) — verified by identity equality in a test.
- [ ] **AC-ABT2**: An already-aborted signal at `beforeExecute` entry causes the runtime to throw `RUNTIME.ABORTED { phase: 'beforeExecute' }` before any middleware body runs.
- [ ] **AC-ABT3**: Mid-`beforeExecute` abort surfaces `RUNTIME.ABORTED { phase: 'beforeExecute' }` promptly even if the middleware body ignores the signal (cooperative cancellation, same contract as `Promise.all` codec dispatch).
- [ ] **AC-ABT4**: A middleware body that throws a non-abort error passes through unchanged (no rewrap to `RUNTIME.ABORTED`).

## Backwards compatibility

- [ ] **AC-COMPAT1**: A middleware authored as `beforeExecute: (plan) => …` (single-arg, pre-extension) compiles and runs against the new shape unchanged.
- [ ] **AC-COMPAT2**: A middleware authored as `beforeExecute: (plan, ctx) => …` (two-arg, sees ctx but not the mutator) compiles and runs unchanged.
- [ ] **AC-COMPAT3**: All existing tests under `packages/2-sql/5-runtime/` and `packages/2-mongo-family/7-runtime/` that exercise middleware pass without modification.

## Family parity

- [ ] **AC-FAM1**: SQL `SqlMiddleware.beforeExecute` shape matches the spec.
- [ ] **AC-FAM2**: Mongo middleware's `beforeExecute` shape mirrors SQL with a Mongo-specific `MongoParamRefMutator` (operating on `MongoParamRef` nodes).
- [ ] **AC-FAM3**: The framework-level `MiddlewareContext` (with `signal`) is shared between SQL and Mongo without family-specific extension. SQL-specific or Mongo-specific middleware-time metadata (if any emerges) lives in family-extending types analogous to `SqlCodecCallContext` (per [ADR 207](../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md)).

## Type safety

- [ ] **AC-TYPE1**: `params.replaceValue(ref, newValue)` infers `newValue` against the codec's declared `TInput` for codec IDs the type system can resolve.
- [ ] **AC-TYPE2**: For ParamRefs without resolvable codec IDs, `newValue` is typed as `unknown` and a docstring documents the runtime-correctness expectation.
- [ ] **AC-TYPE3**: Negative type test: passing a value of the wrong shape to `replaceValue` is a type error pinned by `@ts-expect-error`.

## Worked example: bulk-encrypt middleware

- [ ] **AC-EX1**: A reference implementation of a bulk-encrypt middleware using the `ParamRefMutator` API ships as a test fixture demonstrating:
  - Plan walking via `params.entries()`.
  - Filtering to ParamRefs whose `codecId` matches a registered codec ID set.
  - Single bulk async call (mocked) with `ctx.signal`.
  - `params.replaceValues(...)` to write ciphertexts back.
  - End-to-end test: plan executes against a stub queryable; encoded params reflect the middleware's bulk transformation.

# Other Considerations

## Security

- The mutator's scope-limit (replace values, not structure) is a security property: a malicious or buggy middleware cannot inject SQL, reshape projections, or otherwise change the plan's semantic shape. Reviewers can audit middleware bodies against a fixed surface.
- Middleware bodies run **in the runtime's process**, with full access to the per-query `signal` and to whatever the middleware author imports. The framework does not sandbox middleware. Extension authors are responsible for their own middleware's security posture.

## Cost

- Adding the mutator + ctx parameters is type-only at the public boundary; runtime allocation is negligible. The internal `ParamRefMutator` is built once per `runtime.execute()` call and discarded, sharing the same lifetime as the existing `CodecCallContext`.

## Observability

- Middleware errors surface as `RUNTIME.MIDDLEWARE_FAILED { middlewareName?, phase: 'beforeExecute' }` envelopes (existing pattern). Bulk-pattern middlewares may benefit from emitting a `metrics.middleware.bulk.{batchSize, durationMs}` telemetry event; that's an extension-author concern, not framework-owned.

## Data Protection

- `ctx` does not carry user-bound metadata (session, tenant, request ID) at the framework level. Extensions that want to bind transactional metadata into middleware (e.g. for audit-stamping) compose their own context resolution. The framework `MiddlewareContext` is intentionally minimal.

# References

- [TML-2330 / PR #400](https://github.com/prisma/prisma-next/pull/400) — codec call context with per-query `AbortSignal`. The `signal` plumbed by this project is the same reference.
- [ADR 207](../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md) — the codec-side shape this middleware seam complements.
- [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) — the per-cell codec model this seam composes with (rather than replacing).
- [TML-2360](https://linear.app/prisma-company/issue/TML-2360) — first concrete consumer (CipherStash extension's bulk-encrypt path).
- [framework-gaps audit](../../docs/reference/framework-gaps.md) — original CipherStash team friction inventory; the bulk-encrypt gap is part of G4 and the current microtask-coalescing workaround is described there.

# Open Questions

1. **Should `replaceValues` accept Promises?** The spec says no — middleware must `await` its bulk work and call `replaceValues` synchronously with the resolved values. The alternative (`replaceValues(Promise<updates>)`) is conceptually cleaner but interleaves with the runtime's encode dispatch and complicates reasoning about middleware chain ordering. Default: synchronous; revisit if a real consumer can articulate why async would be cleaner.

2. **Mongo's `MongoParamRef` mutator shape.** Mongo's lowering produces a tree of `MongoParamRef` nodes inside arbitrary `MongoValue` shapes (objects, arrays, leaves), not a flat array. Does `params.entries()` yield a flat iterator, or a structured walk? Probably flat (matches SQL's pattern), but worth confirming when we touch the Mongo side.

3. **Should the mutator be reusable across middleware in the chain?** Each middleware sees a fresh mutator that reflects all prior mutations. This is the natural shape (each middleware sees the current state), but it means the param array is potentially copied multiple times if multiple middlewares mutate. Is that acceptable? My read: yes — it's an extension-level concern (multiple bulk-pattern extensions on the same column would coordinate via codec ID), and the allocation cost is bounded.

4. **`MiddlewareContext` extension story.** The framework-level shape is `{ signal? }`. SQL or Mongo could extend it with family-specific metadata (e.g. SQL middleware might want `{ signal?, plan: SqlExecutionPlan }` exposed). Today's design says *don't* extend — the plan is already passed as the first argument; family-shaped middleware ctx is YAGNI until a real consumer needs it. Confirming.
