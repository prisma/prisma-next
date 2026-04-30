# ADR 207 — Codec call context: per-query `AbortSignal` and column metadata

## Status

Accepted. Apr 30, 2026.

Extends [ADR 204 — Single-Path Async Codec Runtime](./ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) §"Risks & mitigations" by resolving the `AbortSignal` half it named as a known gap. The concurrency-cap half it also named stays open and tracked under [framework-gaps G4](../../reference/framework-gaps.md) / [TML-2330](https://linear.app/prisma-company/issue/TML-2330).

## Context

ADR 204 closed the codec-async-runtime question by treating codec query-time methods as uniformly Promise-returning at the public boundary and always awaiting them. It deliberately landed without two pieces of plumbing it knew were needed by the next class of codec authors:

- **Per-query cancellation.** `AbortSignal` is the standard browser-and-Node.js cancellation primitive, but the codec interface gave authors no way to receive one. KMS-backed codecs (CipherStash's ZeroKMS, Vault, similar) perform real network IO on every encode and decode; a query whose caller has cancelled (HTTP request aborted, transaction deadline expired, user navigation) still completes its in-flight HTTPS round-trip, consuming the budget for a result no one is waiting for.
- **Decode-side column identity.** [framework-gaps G1](../../reference/framework-gaps.md) flagged that the decode site receives a wire value but no information about which `(table, column)` produced it. Envelope-pattern codecs (encrypted columns, signed columns, audit-stamped columns) need column identity at decode time to construct a return value that carries `(table, column)` for participating in subsequent operations the same way the underlying SDK does.

Both requirements meet at the same dispatch site — the per-cell `codec.encode` and `codec.decode` calls inside the runtime's encode/decode loops. Rather than threading two unrelated arguments through every call site, this ADR introduces **one** named context object the runtime threads to every codec call. Today the object carries a signal at the framework level, plus column metadata at the SQL family level. Tomorrow it can carry more without changing the codec author surface — the shape is named, not inlined.

The shape lands as a **family-extension pattern** rather than a single framework type with all the fields, because column metadata's natural shape is family-specific. SQL identifies cells by `(table, column)`; Mongo identifies cells by document path; a future graph store would address by node/edge. Pinning a SQL-shaped `column` slot in the framework-agnostic codec context would push family-shape into the framework layer — a layering violation that the project's first round produced and the second round explicitly corrected. The corrective shape is the one this ADR records.

## Decision

The codec dispatch surface gains a single per-call context object the runtime threads to every `codec.encode` / `codec.decode` invocation for one `runtime.execute()` call. The context is family-extensible: the framework declares a signal-only base, and family layers extend it with their own per-call metadata.

Concretely:

1. **Framework — `CodecCallContext` is signal-only.** Declared as a named, exported interface with one optional readonly field (`signal?: AbortSignal`). Future framework-level fields (cancellation reason metadata, observability hooks) land additively.

2. **SQL family — `SqlCodecCallContext extends CodecCallContext`.** Adds an optional `column?: SqlColumnRef`, where `SqlColumnRef = { readonly table: string; readonly name: string }`. The SQL `Codec` interface narrows `encode`/`decode` to `ctx?: SqlCodecCallContext`; the SQL `codec()` factory's ctx-bearing arity types `ctx` as `SqlCodecCallContext`.

3. **Mongo family — no extension today.** Mongo's read path doesn't go through `codec.decode` (per ADR 204 cross-family scope notes), and Mongo's encode site has no column-context need. Mongo codec authors observe the framework `CodecCallContext` directly. The same family-extension pattern is available when Mongo grows a per-call concept that doesn't generalise (path expression, cluster shard hint, ACL handle).

4. **Codec interface admits the context as an optional second argument.** `encode(value, ctx?: CodecCallContext): Promise<TWire>` and `decode(wire, ctx?: CodecCallContext): Promise<TInput>`, both narrowed to `ctx?: SqlCodecCallContext` on the SQL `Codec`. Existing single-arg codec authors continue to compile and run unchanged.

5. **Factories accept either author arity.** `codec()` and `mongoCodec()` accept `(value)` or `(value, ctx)` (and `(wire)` or `(wire, ctx)`) author functions. The user-facing config types are a **union of the two arities**; the internal lift widens to the two-arg shape so the runtime's `(value, ctx) => userFn(value, ctx)` adapter can forward `ctx` uniformly to either form. The union is load-bearing — a single ctx-bearing config signature widens `TInput` for in-tree codecs whose author signatures are non-trivial (e.g. `sqlTimestampCodec`'s `(value: string | Date): string` infers `TInput=string` only when the signature is single-arg). The union preserves that inference behaviour.

6. **`runtime.execute(plan, options?)` accepts an optional `{ signal? }`.** The framework `RuntimeExecutor<TPlan>` SPI declares `execute<Row>(plan, options?: RuntimeExecuteOptions): AsyncIterableResult<Row>` where `RuntimeExecuteOptions = { readonly signal?: AbortSignal }`. The runtime builds **one** `CodecCallContext` per `execute` from `options.signal` and threads the same reference through the entire encode/decode dispatch — codec authors observe **signal identity** (`===`) at every codec call.

7. **Runtime observes abort at boundaries that track the codec dispatch surface.** The runtime fast-fails already-aborted callers and races in-flight `Promise.all`s of codec calls against the signal. SQL has more dispatch sites and therefore more observation boundaries; Mongo has fewer because its read path doesn't decode.

   | Boundary | SQL phase | Mongo phase |
   | --- | --- | --- |
   | Entry pre-check (before any work) | `stream` | `stream` (inherited from `RuntimeCore.execute`) |
   | Mid-encode (per-level `Promise.all` of codec encodes) | `encode` | `encode` |
   | Mid-decode (per-cell `Promise.all` of codec decodes) | `decode` | — (no codec decode) |
   | Between rows in stream loop | `stream` | — (no decode → no in-loop boundary) |

   Phase tags map onto codec dispatch sites; families gain more phase tags as they gain more dispatch.

8. **`RUNTIME.ABORTED` envelope.** Aborts surface as the standard error envelope shape with code `'RUNTIME.ABORTED'`, `details: { phase: 'encode' | 'decode' | 'stream' }`, and `cause` carrying `signal.reason` verbatim (or a synthesised `DOMException('The operation was aborted.', 'AbortError')` when the caller invoked `controller.abort()` with no argument). Constructed via the `runtimeAborted(phase, cause?)` helper in `framework-components/runtime` so every dispatch site produces an identically-shaped envelope.

9. **Cooperative cancellation.** When the signal aborts mid-flight, the runtime returns `RUNTIME.ABORTED` promptly — but in-flight codec bodies that ignore the signal continue to run in the background and complete normally. The runtime does not attempt to terminate them; the `Promise.race(work, abortPromise)` shape simply abandons the unresolved `work`. Codec authors that wrap a network SDK should forward `ctx.signal` to the SDK so the SDK aborts the in-flight call (KMS round-trip, fetch, etc.); codec authors who don't, ignore it. This is the documented contract; it matches the standard cancellation semantics for `AbortSignal`-aware Promise APIs in the broader ecosystem.

10. **Decode-side `ctx.column` is populated for resolvable cells; encode-side stays undefined.** SQL's decode site populates `ctx.column = { table, name }` per cell from the existing `ColumnRef` resolution that `RUNTIME.DECODE_FAILED` envelope construction already runs. Cells that can't be resolved to a single column (aggregate aliases, computed projections, include-aggregate fields) pass `ctx.column = undefined`; codec authors that need column identity must handle the undefined case explicitly. Encode-side `ctx.column` is intentionally always undefined — encode-time column context is the middleware's domain (a middleware that walks a plan can attach richer column metadata to outbound parameters before encode begins; a codec encoding a value sees the per-call signal but no column identity, because the same encode site encodes parameters for predicates, expressions, and aggregations whose column identity is ambiguous).

11. **Abort-race attribution via sentinel identity.** The framework `raceAgainstAbort(work, signal, phase)` helper (in `framework-components/runtime`) races a codec-dispatch `Promise.all` against the abort signal, distinguishing the two rejection sources by **closure-local sentinel identity** rather than by rejection-value shape. The standard `abortable(signal)` foundation utility rejects with `signal.reason ?? new DOMException(...)`, which is not stably distinguishable from a codec-thrown error by identity alone. The sentinel pattern is load-bearing: it lets a codec body that throws `RUNTIME.ENCODE_FAILED` / `RUNTIME.DECODE_FAILED` pass that envelope through unchanged, even when a signal is supplied — the abort race never rewraps a codec-thrown envelope.

## Architecture

### `CodecCallContext` shape (framework + SQL extension)

```ts
// packages/1-framework/1-core/framework-components/src/codec-types.ts
export interface CodecCallContext {
  readonly signal?: AbortSignal;
}

// packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts
export interface SqlColumnRef {
  readonly table: string;
  readonly name: string;
}

export interface SqlCodecCallContext extends CodecCallContext {
  readonly column?: SqlColumnRef;
}
```

The SQL `Codec` interface narrows `encode`/`decode`'s `ctx` parameter to `SqlCodecCallContext` using **method syntax** (`encode(value, ctx?: SqlCodecCallContext): Promise<TWire>`). Method-syntax method signatures are treated bivariantly under TypeScript's `strictFunctionTypes`, which lets the SQL interface narrow the parameter type without an unsound cast. A future change to property syntax (`encode: (value, ctx?) => ...`) would unwind the narrowing and would be caught by the type-test pins in `codec-call-context.types.test-d.ts` and `codec-factory-ctx.types.test-d.ts`.

### `Codec.encode` / `Codec.decode` admit `ctx?` (uniform across families)

```ts
interface Codec<...> {
  encode(value: TInput, ctx?: CodecCallContext): Promise<TWire>;
  decode(wire: TWire, ctx?: CodecCallContext): Promise<TInput>;
}
```

Strictly additive. Existing codec authors who never reference `ctx` continue to compile and run unchanged. Authors who want the context use either the `(value, ctx)` arity at the factory or the (sync/async) two-arg shape, and the factory's union-arity config preserves `TInput` inference for both.

### `runtime.execute(plan, options?)` and the per-execute ctx

```ts
// packages/1-framework/1-core/framework-components/src/runtime-middleware.ts
export interface RuntimeExecuteOptions {
  readonly signal?: AbortSignal;
}

export interface RuntimeExecutor<TPlan extends QueryPlan> {
  execute<Row>(
    plan: TPlan & { readonly _row?: Row },
    options?: RuntimeExecuteOptions,
  ): AsyncIterableResult<Row>;
}
```

`RuntimeCore.execute` builds **one** `CodecCallContext` per call from `options.signal` and forwards it to the abstract `lower(plan, ctx?)`. SQL's `lower` forwards ctx into `encodeParams`; Mongo's `lower` forwards ctx into `MongoAdapter.lower → resolveValue`. The SQL runtime's per-row `decodeRow` receives the same ctx and constructs per-cell `SqlCodecCallContext` wrappers carrying `column = { table, name }` for resolvable cells. The same `signal` reference reaches every codec call in the entire `execute`.

### `RUNTIME.ABORTED` envelope and `runtimeAborted(phase, cause?)`

```ts
// packages/1-framework/1-core/framework-components/src/runtime-error.ts
export const RUNTIME_ABORTED = 'RUNTIME.ABORTED' as const;
export type RuntimeAbortedPhase = 'encode' | 'decode' | 'stream';

export function runtimeAborted(
  phase: RuntimeAbortedPhase,
  cause?: unknown,
): RuntimeErrorEnvelope;
```

The helper builds an envelope with `code: 'RUNTIME.ABORTED'`, `details: { phase }`, and a `cause` that falls back to `new DOMException('The operation was aborted.', 'AbortError')` when no reason is supplied. The constant + helper are re-exported from `@prisma-next/framework-components/runtime`.

### `raceAgainstAbort` — sentinel-identity attribution

```ts
// packages/1-framework/1-core/framework-components/src/race-against-abort.ts
export async function raceAgainstAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
  phase: RuntimeAbortedPhase,
): Promise<T>;
```

The helper allocates a closure-local sentinel object and registers an `abort` listener that rejects with the sentinel. After `Promise.race([work, abortPromise])`, an `error === sentinel` identity check is unambiguous: only the listener installed in this call ever rejects with this object reference. Any other rejection (codec-thrown envelope, plain Error, anything else) re-throws verbatim. Listener cleanup is belt-and-braces: `addEventListener('abort', onAbort, { once: true })` plus a `finally` block that explicitly removes the listener on the no-abort code path.

### Threading depth

```text
RuntimeCore.execute({ signal })
  └─ codecCtx = { signal }
     ├─ lower(plan, codecCtx)
     │   ├─ SQL: encodeParams(plan, registry, codecCtx)
     │   │       └─ raceAgainstAbort(Promise.all(codec.encode(v, ctx)), signal, 'encode')
     │   └─ Mongo: adapter.lower(plan, codecCtx)
     │             └─ resolveValue(value, codecs, codecCtx)
     │                   └─ raceAgainstAbort(Promise.all(...), signal, 'encode')   (per recursion level)
     │                       └─ codec.encode(v, ctx)
     │
     └─ stream (SQL only):
         for await (rawRow of driver.cursor) {
           if (signal.aborted) throw runtimeAborted('stream', signal.reason)
           decodeRow(rawRow, exec, registry, validators, codecCtx)
             └─ raceAgainstAbort(Promise.all(decodeField(...)), signal, 'decode')
                   └─ codec.decode(wire, { ...rowCtx, column: { table, name } })
         }
```

## Walk-back framing

ADR 204 names seven "walk-back constraints" — shapes the public codec surface must not regrow as concurrency / cancellation work lands. This addition does not regrow any of them:

| Walk-back constraint | Status with ADR 207 |
| --- | --- |
| No `TRuntime` generic on `Codec` | Held — `Codec` retains exactly four type parameters (`Id`, `TTraits`, `TWire`, `TInput`). |
| No `kind` / `runtime` discriminator field on `Codec` | Held — `ctx?` is a method parameter, not an interface field. |
| No conditional return types on `encode` / `decode` | Held — return types remain `Promise<TWire>` / `Promise<TInput>` regardless of arity. |
| No exported sync-vs-async predicates | Held — no new predicates exported. |
| No `Codec.context` alias tying the context shape to async-ness | Held — `CodecCallContext` is a named context interface, not a `Codec.context` alias; the context shape is independent of sync/async authoring. |
| Codec author surface stays "may write sync or async; factory accepts both" — now plus optional `ctx` | Held — the factory accepts sync or async authors of either arity, lifts uniformly, no annotations. |
| `Codec` retains exactly four type parameters | Held. |

The optional second-arg shape doesn't tie the context to async-ness or runtime-shape; it adds a per-call value the dispatch surface threads orthogonally. The future additive `codecSync()` opt-in ADR 204 framed remains available — `codecSync({ encode: (value, ctx?) => ... })` is the natural extension if the sync fast-path lands later.

## Consequences

### What this enables

- **KMS-backed codecs can forward `ctx.signal` to their SDK.** `bulkEncrypt({ signal: ctx.signal })`, `fetch(url, { signal: ctx.signal })`. Aborted requests stop talking to the network service; cold-start budgets stop being consumed for results no one is waiting for; transaction deadlines propagate down to the codec's underlying IO.
- **Envelope-pattern decryption.** A codec that wraps a wire value into a return object carrying column identity (`{ value, column: { table, name } }`) for downstream operations can construct that envelope from `ctx.column` at decode time. Without `ctx.column`, the codec had to reverse-engineer column identity from JS-runtime data type — see [framework-gaps G1](../../reference/framework-gaps.md#g1--codecs-receive-no-per-call-column-metadata) for the multi-column-per-dataType correctness bug this avoids.
- **Cooperative cancellation latency without decode dispatch.** Mongo callers consuming long aggregations get prompt `RUNTIME.ABORTED { phase: 'stream' }` on already-aborted entry. SQL callers get the same plus prompt `phase: 'encode'` and `phase: 'decode'` mid-flight observation.
- **Future bulk-encrypt / bulk-decrypt at the middleware layer.** The decode-side column metadata is now plumbed end-to-end; a future middleware that walks a plan can colocate per-column codec calls into bulk SDK calls without touching the codec author surface.

### What this doesn't enable (deliberate non-goals)

- **No concurrency cap, no rate limit, no batched dispatch.** ADR 204 §"Risks & mitigations" named both `AbortSignal` plumbing and concurrency control as deferred. This ADR addresses only the `AbortSignal` half. A query that touches N rows × M codec'd cells still issues N × M concurrent codec calls; bounding that fan-out is tracked under [TML-2330](https://linear.app/prisma-company/issue/TML-2330) and [framework-gaps G4](../../reference/framework-gaps.md#g4--per-cell-promiseall-codec-dispatch-is-unbounded-for-network-backed-codecs). The codec author surface is forward-compatible — a future bulk-codec interface that registers `bulkEncode(values: TInput[], ctx?): Promise<TWire[]>` alongside `encode` lands additively without changing the per-call shape.
- **No bulk-codec interface.** Codecs continue to declare `encode(value, ctx?)` and `decode(wire, ctx?)` as their per-cell dispatch surface. Microtask-coalescing batchers in extension code (the CipherStash workaround for G4) continue to be the operational path until the framework grows a `bulkEncode` / `bulkDecode` slot.
- **No driver-level cancellation.** When the runtime returns `RUNTIME.ABORTED` mid-stream, the underlying database driver's in-flight statement (Postgres `pg-cursor`, Mongo `aggregate`, etc.) is not cancelled at the wire level. `IteratorClose` semantics ensure the driver's `try/finally` cleanup runs (releasing the cursor, returning the connection to the pool), but the server may still be doing work for a few more rows after the runtime has stopped consuming. Driver-level statement cancellation (Postgres `pg_cancel_backend`, Mongo `killCursors`) is a separate piece of work; the ctx seam is the prerequisite, not the implementation.
- **No transaction-scoped abort composition.** Each `runtime.execute(plan, { signal })` builds its own per-execute context. Multiple statements inside a transaction that share the same caller signal each receive the same `signal` reference (caller passes it to each `execute` call), but the transaction wrapper itself doesn't compose a deadline / cancel-on-rollback / cancel-on-error signal automatically. Callers compose their own controllers if they need transaction-scoped timeouts.
- **No structured cancellation reason taxonomy.** `cause` carries `signal.reason` verbatim; no normalization, no enrichment. If the framework ever grows reason metadata (e.g. `{ kind: 'transaction-deadline'; deadline: Date }`), it can land additively on `CodecCallContext` or the envelope's `details`.

### Driver-implementer expectation

The runtime relies on `IteratorClose` semantics — when the for-await body throws (because abort observation surfaced `RUNTIME.ABORTED`), JavaScript calls `.return()` on the underlying iterator, which propagates cleanup down to the driver's `try/finally` block. Postgres's `pg-cursor` does this correctly today (releases the cursor, returns the connection to the pool). Drivers that wrap an iterator without `try/finally` cleanup risk leaking driver-side resources on abort. The expectation is: drivers that yield rows via async iterators must clean up under iterator-close. This is not a new contract for the driver — it has always been required for normal `break`-out-of-for-await consumption — but the `RUNTIME.ABORTED` path makes it observable.

### Phase-tag attribution is sampled, not subscribed

Between-rows `signal.aborted` checks are **sampled** at the SQL `executeAgainstQueryable` for-await body, not subscribed via an `abort` listener. A signal that aborts immediately after the check passes will not trigger `phase: 'stream'`; the next `decodeRow`'s race will trigger `phase: 'decode'` instead. This is the intended behaviour (the runtime can't get into a stuck state), but the `phase` tag is a hint about which await caused the abort, not a hard guarantee. The cause chain (`error.cause === signal.reason`) and the envelope shape (`code === 'RUNTIME.ABORTED'`) are stable; the phase is best-effort.

### Future work

- **Concurrency cap / bulk-codec dispatcher.** Tracked under [TML-2330](https://linear.app/prisma-company/issue/TML-2330). The codec author surface is ready (the `ctx` seam is forward-compatible with a future `bulkEncode` registration on the codec interface).
- **Mongo per-row signal observation.** A consumer who passes a signal and consumes rows in a long-running for-await currently won't see the abort take effect at the runtime layer until the next driver row arrives or the consumer breaks out of the loop. If this becomes a latency concern, Mongo can grow its own between-rows check inside an `execute` override (matching SQL's pattern); the framework seam is unchanged.
- **Driver-level statement cancellation.** A future change can wire `signal.aborted` into the underlying database driver's cancellation primitive (Postgres `pg_cancel_backend`, Mongo `killCursors`). The runtime side is ready; only the driver side is missing.
- **Trait-gated redaction interaction.** If [TML-2329](https://linear.app/prisma-company/issue/TML-2329) lands a `redactWire` / `redactInput` trait, the `RUNTIME.ABORTED` envelope's `cause` chain (which today carries `signal.reason` verbatim) becomes part of that redaction policy's surface area. The current envelope shape doesn't preclude trait-gated redaction landing additively.

## Implementation evidence

The type and runtime declarations live at:

- Framework `CodecCallContext`: `packages/1-framework/1-core/framework-components/src/codec-types.ts`.
- SQL `SqlColumnRef` + `SqlCodecCallContext` + narrowed `Codec`: `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts`.
- `RUNTIME.ABORTED` constant + `runtimeAborted` helper: `packages/1-framework/1-core/framework-components/src/runtime-error.ts`.
- `raceAgainstAbort` helper: `packages/1-framework/1-core/framework-components/src/race-against-abort.ts`.
- `RuntimeCore.execute(plan, options?)` + per-execute ctx: `packages/1-framework/1-core/framework-components/src/runtime-core.ts`, `packages/1-framework/1-core/framework-components/src/runtime-middleware.ts`.
- SQL runtime threading: `packages/2-sql/5-runtime/src/codecs/encoding.ts`, `packages/2-sql/5-runtime/src/codecs/decoding.ts`, `packages/2-sql/5-runtime/src/sql-runtime.ts`.
- Mongo adapter / runtime threading: `packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts`, `packages/3-mongo-target/2-mongo-adapter/src/mongo-adapter.ts`, `packages/2-mongo-family/7-runtime/src/mongo-runtime.ts`, `packages/2-mongo-family/6-transport/mongo-lowering/src/adapter-types.ts`.

Behavioural and type-level test pins sit alongside each subject file under each package's `test/` directory. End-to-end abort coverage against real drivers lives at `test/integration/test/sql-builder/execution-abort.test.ts` and `test/integration/test/mongo/execution-abort.test.ts`. The full implementation history (m1 framework seam, m1 R2 layering correction, m2 SQL runtime threading, m3 Mongo runtime threading + `raceAgainstAbort` promotion, m4 docs) is tracked in PR [#400](https://github.com/prisma/prisma-next/pull/400) under [TML-2330](https://linear.app/prisma-company/issue/TML-2330).

## References

- [ADR 204 — Single-Path Async Codec Runtime](./ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md). Establishes the always-await codec runtime model and names `AbortSignal` plumbing as a known gap; this ADR resolves that half. The seven walk-back constraints are restated in the table above; this ADR introduces none.
- [ADR 027 — Error Envelope Stable Codes](./ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md). Defines the envelope shape (`code`, `details`, `cause`) used by `RUNTIME.ABORTED`.
- [framework-gaps G10 — `AbortSignal` not plumbed to codec calls](../../reference/framework-gaps.md#g10--abortsignal-not-plumbed-to-codec-calls). Resolved by this ADR.
- [framework-gaps G1 — Codecs receive no per-call column metadata](../../reference/framework-gaps.md#g1--codecs-receive-no-per-call-column-metadata). Decode-side `(table, name)` plumbed by this ADR; richer encode-side column metadata stays open as the middleware's domain — see *Middleware-driven param transformation* ([TML-2359](https://linear.app/prisma-company/issue/TML-2359)).
- [framework-gaps G4 — Per-cell `Promise.all` codec dispatch is unbounded](../../reference/framework-gaps.md#g4--per-cell-promiseall-codec-dispatch-is-unbounded-for-network-backed-codecs). Stays open; concurrency cap / bulk-codec dispatch is tracked under [TML-2330](https://linear.app/prisma-company/issue/TML-2330).
- [TML-2330 — codec call context + concurrency](https://linear.app/prisma-company/issue/TML-2330). The implementation ticket; rate-limit half stays under this ticket.
- [WHATWG `AbortSignal` / `AbortController`](https://dom.spec.whatwg.org/#interface-abortsignal). The cancellation primitive used end-to-end.
