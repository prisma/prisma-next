# Summary

Promote `beforeExecute` middleware to a **mutable param-transformation seam** — middleware can rewrite the values carried in the plan's outbound `ParamRef`s before encode runs, with access to the per-query `AbortSignal` from [TML-2330](https://linear.app/prisma-company/issue/TML-2330) / [ADR 207](../../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md). Unlocks bulk-everything patterns at the framework layer (bulk-encrypt for KMS-backed columns, bulk-sign for audit columns, bulk-validate for cross-column constraints) without each extension growing its own plan-walker or the codec interface growing a new trait.

CipherStash bulk-encrypt — see the [envelope-codec-extension task spec](envelope-codec-extension.spec.md) — is the **first concrete consumer** ([TML-2360](https://linear.app/prisma-company/issue/TML-2360)), not the owner. This task spec belongs to [Project 1](../spec.md) of the [cipherstash-integration umbrella project](../../spec.md).

## Grounding example

A bulk-encrypt middleware that an extension author writes against the new seam:

```ts
import { bulkEncryptMiddleware } from '@prisma-next/extension-cipherstash/middleware';

// Inside the extension:
export const middleware: SqlMiddleware = {
  beforeExecute: async (plan, ctx, params) => {
    // Walk the plan's ParamRefs, filtering for CipherStash columns
    // by codec id.
    const targets: { ref: ParamRefHandle; plaintext: string }[] = [];
    for (const entry of params.entries()) {
      if (entry.codecId === 'cipherstash/string@1' && isEncryptedString(entry.value)) {
        targets.push({ ref: entry.ref, plaintext: entry.value.plaintext });
      }
    }
    if (targets.length === 0) return;

    // One bulk network call per execute(), forwarding the per-query signal.
    const ciphertexts = await cipherstashSdk.bulkEncrypt({
      values: targets.map((t) => t.plaintext),
      signal: ctx.signal,
    });

    // Write the ciphertexts back into the plan; codec.encode runs identity from here.
    params.replaceValues(
      targets.map((t, i) => ({ ref: t.ref, newValue: ciphertexts[i] })),
    );
  },
};
```

The same shape works for any "transform outbound parameters before encode" pattern: signing (each row gets a signature derived from N other column values), audit-stamping (insert auto-populated `last_modified_by` from the runtime's session), bulk-validating cross-column constraints, etc.

## Decision

The middleware contract grows two additive parameters and one new family-extensible context type. Three load-bearing choices:

- **`beforeExecute(plan, ctx, params)` gains a third parameter, a `ParamRefMutator`.** Middleware can iterate the plan's outbound parameter values via `params.entries()` and replace them via `params.replaceValue(ref, newValue)` / `params.replaceValues(updates)`. The mutator is **scoped**: replace `ParamRef.value` slots only — no SQL rewriting, no projection mutation, no insert/remove of `ParamRef`s.

- **`MiddlewareContext.signal` carries the per-query `AbortSignal`.** The same reference [TML-2330](https://linear.app/prisma-company/issue/TML-2330)'s `CodecCallContext` carries — middleware authors observe **signal identity** between `beforeExecute(ctx)` and any subsequent codec call within the same `runtime.execute()` invocation. Middleware that wraps a network SDK forwards `ctx.signal` to that SDK; pure CPU middleware ignores it.

- **The mutator is synchronous.** Middleware bodies that need async work (bulk SDK calls, etc.) `await` first, then call `params.replaceValues(...)` synchronously with the resolved values. Async mutation would interleave with the runtime's encode dispatch and complicate reasoning about middleware chain ordering.

Everything else falls out: the runtime allocates a `MiddlewareContext` once per execute and threads the same reference through every middleware phase (`beforeExecute`, `afterExecute`, `onRow`); SQL and Mongo share the framework-level `MiddlewareContext`; family-specific mutators (`SqlParamRefMutator`, `MongoParamRefMutator`) extend a base `ParamRefMutator` shape.

## Why

[ADR 204](../../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) made codec query-time methods uniformly Promise-returning at the per-cell `codec.encode` / `codec.decode` boundary. That works for codecs whose work fits the per-cell shape (a single value transformation) but has no answer for codecs whose work is **inherently bulk** — KMS-backed encryption being the canonical case. Network-backed services are efficient only when amortized across many ciphertexts in one round-trip; per-cell `codec.encode` calls fan out to N independent HTTPS requests, which the runtime races concurrently but does not coalesce.

The first attempt at solving this (the CipherStash team's `cipherstash/stack` repo, `prisma-next` branch) used a **microtask-coalescing batcher** inside the codec body: every `codec.encode` call enqueues into a shared queue, a microtask flushes the queue with one bulk SDK call, the codec resolves each per-cell promise. This works but pushes concurrency control, batch sizing, abort handling, and SDK-specific error attribution into the codec body — squeezed into a per-cell shape that doesn't fit any of them.

The cleaner model: let the **plan-walker** (something that already knows the full plan, the column metadata, and the per-query signal) batch the work, then have `codec.encode` run as identity once the batch has produced its outputs. The framework already has a hook for this — `beforeExecute` middleware — but two things stop it being usable today:

- **`beforeExecute` is read-only.** Middleware can observe the plan and short-circuit; it cannot mutate `ParamRef.value` to replace plaintext with ciphertext.
- **The middleware context doesn't carry the signal.** Bulk-encrypt middleware that calls `bulkEncrypt({ signal })` needs the per-query `AbortSignal` reference, which today lives only on the codec call context.

This project closes both gaps with the additions above.

## How it works

### Types

```ts
// packages/1-framework/1-core/framework-components/src/middleware-types.ts
export interface MiddlewareContext {
  readonly signal?: AbortSignal;
}

// SQL family — mutator and supporting types live in relational-core
// because the ParamRef shape is SQL-specific. Mongo declares its own
// MongoParamRefMutator analogously over MongoParamRef.

export interface ParamRefHandle {
  // Opaque token identifying a single ParamRef in the plan. The mutator
  // accepts only handles it produced; user-constructed handles are rejected
  // at the type level.
}

export interface ParamRefEntry {
  readonly ref: ParamRefHandle;
  readonly value: unknown;
  readonly codecId: string | undefined;
  readonly column?: SqlColumnRef;
}

export interface SqlParamRefMutator {
  /** Iterate every outbound ParamRef the plan currently carries. */
  entries(): IterableIterator<ParamRefEntry>;

  /** Replace one ParamRef's value with the result of bulk processing. */
  replaceValue(ref: ParamRefHandle, newValue: unknown): void;

  /** Replace many at once (typical for bulk-pattern middleware). */
  replaceValues(updates: Iterable<{ ref: ParamRefHandle; newValue: unknown }>): void;
}

// SQL middleware — the additive third parameter.
export interface SqlMiddleware {
  readonly beforeExecute?: (
    plan: SqlExecutionPlan,
    ctx: MiddlewareContext,
    params: SqlParamRefMutator,
  ) => void | Promise<void>;
  readonly afterExecute?: (plan: SqlExecutionPlan, ctx: MiddlewareContext) => void | Promise<void>;
  readonly onRow?: (row: Row, ctx: MiddlewareContext) => Row | Promise<Row>;
}
```

### Threading

```text
runtime.execute(plan, { signal })
  └─ middlewareCtx = { signal }   ← same reference as codecCtx (ADR 207)
     ├─ for each middleware in chain:
     │     await middleware.beforeExecute(plan, middlewareCtx, paramsMutator)
     │     ↑
     │     paramsMutator built lazily — first call to replaceValue/replaceValues
     │     allocates the new param array; if no middleware mutates, the original
     │     plan.params is forwarded to encodeParams unchanged (bit-for-bit).
     ├─ encodeParams(plan, registry, codecCtx)
     ├─ executeAgainstQueryable(plan, signal)
     ├─ for each middleware in chain (reverse order):
     │     await middleware.afterExecute(plan, middlewareCtx)
     └─ for await (rawRow of stream):
          for each middleware in chain:
            row = await middleware.onRow(row, middlewareCtx)
          yield row
```

### Mutation timing

`beforeExecute` runs **after** plan finalization (lowering complete, codec ids assigned to each `ParamRef`) and **before** any `codec.encode` call. A middleware that mutates a value:

- Sees the value as it was authored (or as a prior middleware in the chain left it).
- Produces a value the corresponding codec's `encode` will receive.
- Is responsible for ensuring `newValue` matches the codec's expected `TInput`.

Multiple middlewares mutating the same `ParamRef` apply in chain order; each sees the prior middleware's mutation as the current state.

### Type safety on `replaceValue`

`replaceValue(ref, newValue)` infers `newValue`'s expected type from the codec id stored on `ref`'s `ParamRef`, when the runtime can resolve it. For codec ids the type system can't resolve (legacy, dynamic), `newValue` is `unknown` and the middleware is on the hook for runtime correctness.

### Allocation discipline

The mutator is constructed lazily. If no middleware in the chain calls `replaceValue` / `replaceValues`, the runtime never copies the param array — the existing fast path is preserved bit-for-bit. The mutator's iteration is also lazy: `entries()` walks the plan's existing `ParamRef[]` without allocating an intermediate array.

### Cooperative cancellation

Same contract as the codec dispatch sites established by [ADR 207](../../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md):

- **Already-aborted at entry** to any middleware phase short-circuits via `checkAborted(ctx, 'beforeExecute' | 'afterExecute' | 'onRow')`.
- **Mid-flight aborts** during a middleware body race against the signal; the runtime returns `RUNTIME.ABORTED` promptly while in-flight middleware bodies that ignore the signal complete in the background.
- Middleware bodies that throw a non-abort error pass through unchanged (no rewrap).

### Backwards compatibility

Existing `beforeExecute: (plan) => …` and `beforeExecute: (plan, ctx) => …` middleware signatures continue to compile via TypeScript bivariance for trailing parameters. The third `params` parameter is additive; existing middleware that doesn't reference it is unchanged.

### Mongo

Mongo's middleware contract grows the same shape with a `MongoParamRefMutator` operating on `MongoParamRef` nodes. The framework-level `MiddlewareContext` is shared (no Mongo extension needed today). `entries()` yields a flat iterator regardless of where the `MongoParamRef` lives in the lowered tree (object, array, leaf), matching SQL's pattern.

## What this enables

- **Bulk-encrypt middleware for KMS-backed columns** ([TML-2360](https://linear.app/prisma-company/issue/TML-2360)) — the first consumer; ~50 lines of middleware code instead of a microtask-coalescing batcher inside the codec body.
- **Audit-stamping middleware** that auto-populates `last_modified_by` / `created_at` from the runtime's session context, without each model declaring the column author-side.
- **Cross-column validation** that reads multiple `ParamRef`s, validates a derived constraint, and short-circuits with an error envelope before encode runs.
- **Bulk-sign middleware** that derives a row-level signature from N column values and stores the result in another `ParamRef`.

## Non-goals

- **No general AST-rewrite middleware.** Mutator scope is `ParamRef.value` slots only. SQL rewriting, projection mutation, plan restructuring stay reserved for the lowering layer or for explicit `beforeCompile` (which already exists for plan-shape transforms).
- **No middleware-driven concurrency control.** Middleware runs sequentially in registration order; concurrency-bounding of the codec dispatch fan-out is a separate concern (currently tracked under [TML-2330](https://linear.app/prisma-company/issue/TML-2330)).
- **No bulk-decode middleware.** Decode-side bulk work uses a different pattern — codecs return envelope objects (per [TML-2360](https://linear.app/prisma-company/issue/TML-2360)) carrying handles, and user code calls bulk-decrypt utilities post-buffering. Middleware doesn't fit the streaming-decode boundary cleanly.
- **No new codec interface trait.** The codec interface stays per-cell and unchanged. Bulk semantics live at the middleware layer.

## Acceptance criteria

Validation hooks on the design above. Implementation is complete when each is met.

### Mutation surface

- [ ] **AC-MUT1**: `beforeExecute` middleware receives `(plan, ctx, params)` and existing `(plan)` / `(plan, ctx)` shapes continue to compile.
- [ ] **AC-MUT2**: `params.entries()` enumerates every `ParamRef` in canonical order with `{ ref, value, codecId, column? }`.
- [ ] **AC-MUT3**: A subsequent `codec.encode` call on a mutated `ParamRef` receives the new value, not the original.
- [ ] **AC-MUT4**: Middleware **cannot** insert/remove `ParamRef`s, rewrite SQL strings, or modify projection — exposed surface enforces this at the type level.
- [ ] **AC-MUT5**: When no middleware in the chain mutates, `plan.params` reaches `encodeParams` by reference identity (no allocation regression).

### Cancellation

- [ ] **AC-ABT1**: `MiddlewareContext.signal` is the same reference passed to `runtime.execute(plan, { signal })` (or `undefined`); verified by identity equality in a test.
- [ ] **AC-ABT2**: An already-aborted signal at `beforeExecute` entry throws `RUNTIME.ABORTED { phase: 'beforeExecute' }` before any middleware body runs.
- [ ] **AC-ABT3**: Mid-`beforeExecute` abort surfaces `RUNTIME.ABORTED` promptly even when the middleware ignores the signal (cooperative cancellation, racing via `raceAgainstAbort`).
- [ ] **AC-ABT4**: Middleware bodies that throw non-abort errors pass through unchanged.

### Family parity

- [ ] **AC-FAM1**: SQL `SqlMiddleware.beforeExecute` and Mongo `MongoMiddleware.beforeExecute` share the framework-level `MiddlewareContext` shape.
- [ ] **AC-FAM2**: Mongo's `MongoParamRefMutator.entries()` flattens `MongoParamRef` nodes from the lowered tree (objects, arrays, leaves).

### Type safety

- [ ] **AC-TYPE1**: `params.replaceValue(ref, newValue)` infers `newValue` from the codec's declared `TInput` for resolvable codec ids.
- [ ] **AC-TYPE2**: Negative type test — passing a value of the wrong shape to `replaceValue` is a type error pinned by `@ts-expect-error`.

### Worked example

- [ ] **AC-EX1**: A reference bulk-pattern middleware ships as a test fixture demonstrating: plan walking via `entries()`, codec-id filtering, single bulk async call with `ctx.signal`, `replaceValues` writeback. End-to-end test: plan executes against a stub queryable; encoded params reflect the middleware's transformation.

## Open questions

1. **Should `replaceValues` accept a Promise of updates?** Default: no — middleware awaits, calls synchronously. Async mutator would interleave with the runtime's encode dispatch and complicate ordering reasoning. Confirm before implementation.
2. **Mongo's flat `entries()` iterator over a tree-shaped `MongoParamRef` walk.** Confirmed flat; specifically whether parent-path metadata (which object key / array index a `MongoParamRef` came from) is exposed to middleware is open. Default: no — middleware identifies refs by codec id, not path. Confirm.
3. **Mutator reuse across chained middleware.** Each middleware sees a fresh mutator reflecting all prior mutations. Multiple middlewares mutating the same column allocate the param array once per mutating middleware. Acceptable cost; a multi-middleware single-allocation optimization is a phase-2 concern if it ever becomes a hot path.
4. **`MiddlewareContext` family extension story.** Today shared, no SQL/Mongo extension needed. If a real consumer needs family-shaped middleware ctx (e.g. SQL middleware wanting `executionPlan` as an additional ctx field), follow the `SqlCodecCallContext extends CodecCallContext` precedent established in [ADR 207](../../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md).

## Alternatives considered

### Per-cell codec batcher (microtask coalescing)

The CipherStash team's first integration used this pattern: the codec body owns a shared queue and a `Promise.resolve().then(...)` flush hook. Every `codec.encode` call enqueues into the queue; the microtask flushes once per JS turn with one bulk SDK call.

**Rejected** because the codec body ends up owning concurrency control, batch sizing, abort handling, and SDK error attribution — all squeezed into the per-cell shape that doesn't fit any of them. The pattern is also opaque: extension authors implementing similar (Vault, AWS KMS, signing) would each rediscover the same workaround.

### A new "bulk codec" trait on the codec interface

Add `bulkEncode(values: TInput[], ctx)` / `bulkDecode(wires: TWire[], ctx)` to `Codec`. The runtime detects the trait and dispatches in bulk.

**Rejected** because it duplicates the codec contract, complicates the codec author surface (which arity wins? what if the runtime calls `encode` for one row and `bulkEncode` for another?), and forces every codec to opt into bulk at the codec layer. The middleware seam keeps the codec interface unchanged and lets *the consumer* (extension) own bulk semantics where they belong.

### General AST-rewrite middleware

Let `beforeExecute` mutate any AST node — SQL strings, projection items, `ParamRef`s — for maximum flexibility.

**Rejected** because the blast radius is unbounded. A misbehaving or malicious middleware could inject SQL, reshape projections, or change the plan's semantic shape. Scoping the mutator to `ParamRef.value` slots is a security property: middleware can produce *incorrect values*, but cannot produce a *structurally different plan*.

### Async mutator (`replaceValues(Promise<updates>)`)

Let middleware return a Promise of updates that the runtime awaits before encode runs.

**Rejected** because it interleaves with the runtime's encode dispatch (the runtime would have to delay `encodeParams` on every middleware's mutation promise) and complicates middleware chain ordering (does middleware-2 see middleware-1's pending mutation?). Sync mutation with author-side `await` keeps the mental model simple: bulk SDK call awaits, then mutator writes synchronously.

### Pass `MiddlewareContext` only to `beforeExecute`

Don't carry the signal through to `afterExecute` or `onRow`.

**Rejected** because middleware that wraps a downstream observability hook or post-processor needs the signal at every phase, not just `beforeExecute`. Symmetric plumbing matches the codec dispatch sites' shape and avoids each consumer needing a workaround.

## References

- [ADR 207 — Codec call context: per-query `AbortSignal` and column metadata](../../../../docs/architecture%20docs/adrs/ADR%20207%20-%20Codec%20call%20context%20per-query%20AbortSignal%20and%20column%20metadata.md). The codec-side context this seam complements; the `signal` plumbed by this project is the same reference. **Forthcoming** with [PR #400](https://github.com/prisma/prisma-next/pull/400) — the ADR file does not yet exist on `main` or this branch.
- [ADR 204 — Single-Path Async Codec Runtime](../../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md). The per-cell codec model this seam composes with (rather than replacing).
- [TML-2330 / PR #400](https://github.com/prisma/prisma-next/pull/400) — the `CodecCallContext` plumbing prerequisite. The `signal` reference originates there.
- [TML-2359](https://linear.app/prisma-company/issue/TML-2359) — this project's tracking ticket.
- [TML-2360](https://linear.app/prisma-company/issue/TML-2360) — first concrete consumer; `projects/cipherstash-integration/specs/envelope-codec-extension.spec.md`.
