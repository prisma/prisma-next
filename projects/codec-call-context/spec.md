# Summary

Introduce a `CodecCallContext` object that the runtime threads through every `codec.encode` / `codec.decode` call, with a family-extension pattern so SQL-specific shape-of-call metadata stays in the SQL layer:

1. **`signal: AbortSignal` (framework, all families)** — per-query cancellation, so codecs that perform network I/O (KMS, Vault, audit-trail-bound types) can forward cancellation to their underlying SDK and the runtime can stop yielding rows promptly when the caller aborts.
2. **`column: { table, name }` (SQL only, via `SqlCodecCallContext extends CodecCallContext`)** — the (table, column) the cell belongs to, populated for **decode** calls so SQL codecs can construct return values that carry column identity (e.g. an envelope handle that knows what to bulk-decrypt against).

No concurrency cap, no bulk-codec interface, no traits — just plumbing one shared context object per query, with a SQL-family extension that adds the column ref.

# Description

The single-path async codec runtime ([ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md)) made codec query-time methods uniformly Promise-returning and dispatches every per-cell `codec.encode` / `codec.decode` call concurrently via `Promise.all`. ADR 204 §"Risks & mitigations" explicitly named cancellation as a known gap:

> **`AbortSignal` plumbing.** Tracked under [TML-2330](https://linear.app/prisma-company/issue/TML-2330). The natural seam is plumbing an `AbortSignal` through the runtime context onto each codec call so the scheduler can cancel pending bodies on the first rejection or on user-initiated cancellation.

Independently, [`docs/reference/framework-gaps.md`](../../docs/reference/framework-gaps.md) G1 ("Codecs receive no per-call column metadata") describes a related gap from the CipherStash integration's perspective: a codec's `decode(wire)` call has no way to know which `(table, column)` the cell came from, which prevents the codec from returning a value that carries enough context to participate in later bulk operations.

This project addresses both gaps with one structural change: introduce `CodecCallContext` as the shared per-call context object at the framework level (signal-only), introduce `SqlCodecCallContext` in the SQL layer (extending it with the column ref), and thread one ctx per `execute()` invocation through every codec dispatch site. The two fields share the same plumbing — same call sites, same identity guarantee for `signal`, same factory contract for codec authors — but the SQL-specific column metadata stays inside the SQL family per the framework/family layering convention (the framework `Codec` interface is target-agnostic and cannot encode SQL's `(table, column)` addressing model). Mongo today uses the framework `CodecCallContext` directly without extension.

For the canonical motivating use case — CipherStash's ZeroKMS-backed encrypted-storage codec — the combination unlocks two patterns at the extension layer:

- **Read path:** `codec.decode(wire, ctx)` constructs an envelope `EncryptedString` that captures the wire value plus `ctx.column` as the handle for later bulk-decrypt; user-space helpers (`decryptAll`, `decryptFields`, `decryptColumn`) walk results, group envelopes by handle, and issue one bulk-decrypt round-trip per group.
- **Cancellation:** every codec call (encode and decode) receives `ctx.signal`; codec authors who forward it to their SDK get true HTTPS cancellation when the caller aborts, and the runtime returns `RUNTIME.ABORTED` promptly even when codec bodies don't forward.

This project intentionally **does not** address two related concerns:

- **Bulk encrypt at write time** is solved at the *middleware* layer, not the codec layer (see the *Middleware-driven param transformation* ticket — middleware sees the plan and column descriptors directly, doesn't need `codec.encode` involvement). Tracked separately.
- **Concurrency-bounding** of `Promise.all` codec dispatch (framework-gaps G4-option-2 / per-trait rate limits) is a different problem space (windowing, multi-extension coordination) and is deferred. Today's `Promise.all` shape is preserved unchanged.

# Requirements

## Functional Requirements

1. **`runtime.execute()` accepts an optional `{ signal }` option.**
   - SQL: `runtime.execute(plan, { signal? }: { signal?: AbortSignal })` returns the existing `AsyncIterableResult<Row>`.
   - Mongo: `mongoRuntime.execute(plan, { signal? })` returns `AsyncIterableResult<Row>`.
   - The framework-level `RuntimeCore.execute` and the `RuntimeExecutor<TPlan>` interface accept the same options shape so SQL and Mongo share one signature.
   - Omitting `signal` (or passing `undefined`) preserves today's behavior bit-for-bit.

2. **Codec query-time methods accept an optional context object, family-extensible.**

   The base context lives in `framework-components` and is family-agnostic:

   ```ts
   // packages/1-framework/1-core/framework-components/src/codec-types.ts
   export interface CodecCallContext {
     readonly signal?: AbortSignal;
   }
   ```

   Each family extends the base with its own shape-of-call metadata. SQL adds the column ref:

   ```ts
   // packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts
   export interface SqlColumnRef {
     readonly table: string;
     readonly name: string;
   }
   export interface SqlCodecCallContext extends CodecCallContext {
     readonly column?: SqlColumnRef;
   }
   ```

   Mongo continues to use the framework `CodecCallContext` directly today (its read path doesn't go through `codec.decode`; its encode site has no column-context need); a `MongoCodecCallContext` placeholder is not introduced by this project.

   - The framework `Codec.encode(value, ctx?: CodecCallContext)` / `Codec.decode(wire, ctx?: CodecCallContext)` admit only the family-agnostic context. Framework code that dispatches codecs sees only `signal`.
   - The SQL `Codec` interface (which already extends the framework `BaseCodec` in [`relational-core/src/ast/codec-types.ts`](../../packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts) with SQL-specific metadata) narrows `encode`/`decode` to use `SqlCodecCallContext`. SQL codec authors writing for the SQL factory get the SQL-specific ctx.
   - The argument is strictly additive: codec authors who ignore `ctx` continue to work unchanged.
   - The factory (`codec()` in `relational-core`, `mongoCodec()` in `mongo-codec`) accepts author functions that take either `(value)` or `(value, ctx)` and lifts both shapes uniformly. The SQL factory's ctx-bearing arity types `ctx` as `SqlCodecCallContext`; the Mongo factory uses base `CodecCallContext`. Sync authoring continues to work identically.

3. **The runtime threads the per-`execute` signal to every codec call for that query.**
   - SQL encode path: `execute → lower → encodeParams → encodeParam → codec.encode(value, ctx)`.
   - SQL decode path: per-row `decodeRow → decodeField → codec.decode(wire, ctx)`.
   - Mongo encode path: `execute → lower → resolveValue → codec.encode(value, ctx)`.
   - Each codec call receives a `ctx` whose `signal` is the same `AbortSignal` instance for the lifetime of that `execute` call.

4. **The SQL runtime populates `ctx.column` on decode calls.**
   - SQL decode builds a per-cell `SqlCodecCallContext` whose `column = { table, name }` is populated whenever the decode site can resolve a `ColumnRef` for the cell (which is the case for projected columns from a single-table source; the existing per-cell `ColumnRef` resolution in `decodeRow` provides this).
   - Cells that the runtime cannot resolve to a single `(table, name)` (e.g. computed projections, aggregates, includes) have `ctx.column = undefined`. This is observable to codecs; codecs that require column identity must handle `undefined` explicitly (no implicit defaulting).
   - Mongo decode is out of scope per ADR 204 (Mongo's read path doesn't go through `codec.decode`); Mongo does not extend `CodecCallContext` in this project.
   - **Encode-side `ctx.column` is not populated by this project.** Encode-time column context is the middleware's domain (see *Middleware-driven param transformation*); the SQL `SqlCodecCallContext` shape allows the field on encode but the runtime always leaves it `undefined` there.
   - The framework `CodecCallContext` has no `column` field at all; column metadata is a SQL-family concept and lives only on `SqlCodecCallContext`.

5. **The runtime stops yielding rows promptly when the signal aborts.**
   - The for-await row loop in `executeAgainstQueryable` checks `signal.aborted` between rows and exits with `RUNTIME.ABORTED`.
   - When `Promise.all` of in-flight codec calls is awaiting, the runtime races it against the signal (using the existing `abortable(signal)` helper) so an aborting caller observes `RUNTIME.ABORTED` even if some codec bodies are unaware of the signal and run to completion in the background.

6. **A signal already aborted at call time short-circuits.**
   - If `signal.aborted === true` when `execute()` is called, the returned `AsyncIterableResult` rejects on first `next()` with `RUNTIME.ABORTED`. No codec calls are made.
   - `encodeParams` / `decodeRow` / `resolveValue` similarly short-circuit when entered with an already-aborted signal.

7. **`RUNTIME.ABORTED` envelope shape.**
   - Code: `'RUNTIME.ABORTED'`.
   - Details: `{ phase: 'encode' | 'decode' | 'stream' }` indicating where the abort was observed.
   - The native abort reason (the `signal.reason` or fallback `DOMException`) attached on `cause`.
   - The error envelope conforms to the existing `RuntimeError` shape produced by `runtimeError(...)`.

8. **Signal forwarding is opt-in for codec authors.**
   - The framework guarantees the signal reaches the codec; what the codec does with it is the author's choice.
   - A codec that ignores `ctx.signal` continues to work; its body runs to completion if abort fires mid-call. The runtime still returns `RUNTIME.ABORTED` to the caller.
   - A codec that forwards `ctx.signal` to its underlying SDK (e.g. `kmsClient.send(cmd, { abortSignal: ctx.signal })`) sees the in-flight HTTPS call cancel.

9. **Column-context use is opt-in for SQL codec authors.**
   - The SQL runtime guarantees `ctx.column` is populated when resolvable on decode (via `SqlCodecCallContext`); what the codec does with it is the author's choice.
   - A codec that ignores `ctx.column` continues to work; the field's presence does not change the codec's contract for any value type today.
   - Mongo codec authors do not see `ctx.column` (the framework `CodecCallContext` has no such field).

## Non-Functional Requirements

1. **No public-API churn beyond the additive context arg.** No `TRuntime` generic; no async/sync marker on the codec interface; no conditional return types; no exported sync-vs-async predicates; no per-codec-or-per-trait scheduler / dispatcher / worker-pool abstraction. ADR 204's walk-back constraints are preserved (see ADR 204 §"Walk-back framing").

2. **No new traits.** This project does **not** introduce `networkBound`, `rateLimited`, or any other trait. Future concurrency / bulk work is welcome to introduce traits but is out of scope here.

3. **Per-cell allocation overhead is unchanged.** Pure-CPU codecs hit the existing fast path: one Promise per cell, one microtask tick per row. The runtime constructs a single shared `ctx` per `execute()` for query-wide fields (`signal`); per-cell fields (`column`) are resolved from already-computed metadata (the SQL decode site already builds `ColumnRefIndex` and resolves per-cell `ColumnRef` for error-wrapping) and packaged into a per-cell `ctx` that shares the same `signal`. The decode site already pays this resolution cost; the only new allocation is the per-cell ctx object.

4. **Type-checking time is net-neutral.** No new generics on `Codec`; no conditional types tied to context-arg shape; the optional `ctx` arg is a single addition to two method signatures.

5. **Cooperative-cancellation semantics, not pre-emptive.** The runtime cannot cancel a codec body that ignores the signal; that body runs to completion in the background. The contract is "the runtime returns promptly; in-flight bodies are abandoned." This is documented in the ADR.

## Non-goals

- **Concurrency cap on `Promise.all` codec dispatch** (tracked separately under framework-gaps G4-option-2; deferred). Today's `Promise.all` shape is preserved unchanged.
- **Bulk-codec interface** (`bulkEncode` / `bulkDecode`; framework-gaps G4-option-1). Out of scope. Bulk encrypt at write time is solved by the *Middleware-driven param transformation* ticket; bulk decrypt at read time is solved by extension-owned helpers operating on envelopes constructed via `ctx.column`.
- **Cross-row decode windowing** (buffering rows from the result stream to coalesce codec calls across rows). Out of scope.
- **`networkBound` / `rateLimited` traits.** Out of scope.
- **Encode-side column-context plumbing.** The encode call site does not populate `ctx.column`; encode-time column context is the middleware's domain. The codec context shape allows the field on encode but the runtime always passes `undefined` there.
- **G1 in full.** This project covers the decode-side `(table, name)` half of G1, sufficient for envelope-handle construction. Richer column metadata (codec annotations, nullability hints, downstream type info) can extend `ctx.column` later without breaking the additive contract.
- **Driver-level cancellation** (forwarding `signal` to `pg`, MongoDB driver, etc., so an in-flight SQL query is killed at the connection level). Worth doing later; the codec story is independently useful and stands on its own.
- **Transaction- or connection-scoped signals.** Composition (e.g. `tx.execute(plan, { signal })` inheriting from a transaction-scoped signal via `AbortSignal.any(...)`) is a future enhancement; per-`execute` signal covers the headline use case.
- **Changes to the codec error redaction policy.** `RUNTIME.ENCODE_FAILED` / `RUNTIME.DECODE_FAILED` envelope shape and redaction triggers are unchanged.
- **Middleware param mutation seam.** Extending `beforeExecute` to return a mutated plan (so middleware can substitute encrypted wire values for cipherstash params before encode) is the *Middleware-driven param transformation* ticket. The middleware's execute context will gain `signal` there, mirroring the codec ctx, but it's a separate, smaller change to the middleware framework.

# Acceptance Criteria

## Public API

- [ ] `runtime.execute(plan)` and `runtime.execute(plan, { signal })` are both valid call sites; the option is optional.
- [ ] The `RuntimeExecutor<TPlan>` interface in `framework-components` carries the optional `{ signal }` options arg in its `execute` signature.
- [ ] `RuntimeCore.execute` accepts and forwards the signal to `lower` (encode-side) and through `runWithMiddleware` (decode/stream side).
- [ ] SQL `SqlRuntimeImpl.execute`, `executeAgainstQueryable`, `lower` accept the signal.
- [ ] Mongo `MongoRuntime.execute` and `MongoAdapter.lower` accept the signal.
- [ ] The public `Codec` interface in `framework-components` declares `encode(value, ctx?: CodecCallContext): Promise<TWire>` and `decode(wire, ctx?: CodecCallContext): Promise<TInput>`, where `CodecCallContext = { readonly signal?: AbortSignal }` (signal-only at the framework level).
- [ ] The SQL `Codec` interface (in `relational-core/src/ast/codec-types.ts`) redeclares `encode`/`decode` with `ctx?: SqlCodecCallContext`, where `SqlCodecCallContext extends CodecCallContext` adds `readonly column?: SqlColumnRef` and `SqlColumnRef = { readonly table: string; readonly name: string }`.
- [ ] The Mongo `Codec` type continues to use the framework `CodecCallContext` directly (no Mongo-specific extension introduced by this project).
- [ ] `codec()` (SQL) accepts author functions of either arity (`(value) => …` or `(value, ctx: SqlCodecCallContext) => …`); `mongoCodec()` accepts author functions of either arity with `ctx: CodecCallContext`. Both factories produce a `Codec` whose method signatures match the public interface for that family.
- [ ] Adding the `ctx` arg does not break any existing codec author site (compatibility verified by typecheck of in-tree codecs).

## Plumbing

- [ ] `encodeParams(plan, registry, ctx?: SqlCodecCallContext)` accepts and threads `ctx` to each `encodeParam` → `codec.encode`. `ctx.column` is left `undefined` for encode call sites (encode-time column metadata is the middleware's domain).
- [ ] `decodeRow(row, plan, registry, jsonValidators, ctx?: SqlCodecCallContext)` accepts and threads `ctx` to each `decodeField` → `codec.decode`, building a per-cell `SqlCodecCallContext` whose `column = { table, name }` is populated from the existing per-cell `ColumnRef` resolution where available, and `undefined` otherwise.
- [ ] `resolveValue(value, codecs, ctx?: CodecCallContext)` (Mongo) accepts and threads `ctx` to each leaf `codec.encode` call. The Mongo path uses the base framework `CodecCallContext` (no `column`).
- [ ] The `signal` field of every per-cell `ctx` is the *same `AbortSignal` instance* throughout a single `execute()` invocation (so a codec receiving it observes a stable signal identity across encode and decode of the same query).
- [ ] When `ctx.signal` is undefined and (for SQL decode) `ctx.column` is undefined, all dispatch sites behave bit-for-bit identically to today (pinned by regression tests against existing snapshot fixtures).

## Abort semantics

- [ ] If `signal.aborted === true` at `execute()` entry, the returned `AsyncIterableResult` rejects on first `next()` with a `RUNTIME.ABORTED` envelope. No codec calls are made (verified by mock codec call counter).
- [ ] If the signal aborts during `encodeParams` (after some codec calls have started), the runtime throws `RUNTIME.ABORTED` with `{ phase: 'encode' }`. In-flight codec bodies run to completion (cooperative); the abort error reaches the caller without waiting for them.
- [ ] If the signal aborts during `decodeRow` for a single row, the runtime throws `RUNTIME.ABORTED` with `{ phase: 'decode' }`.
- [ ] If the signal aborts between rows in the result stream, the for-await loop exits with `RUNTIME.ABORTED` with `{ phase: 'stream' }` before pulling the next raw row.
- [ ] A codec that forwards `ctx.signal` to a mock SDK call observes the SDK call abort with the propagated signal (verified by an integration-style test using a fixture codec that calls a fake fetch).
- [ ] A codec that ignores `ctx.signal` does not break the abort path; the runtime still returns `RUNTIME.ABORTED` while the codec body completes in the background (verified by a fixture codec with a deliberate `setTimeout`).

## Column-context semantics

- [ ] A SQL decode call for a projected column from a single-table source receives a `SqlCodecCallContext` whose `column = { table, name }` matches the underlying column ref (verified with a fixture codec that records observed `ctx.column` values per call).
- [ ] A SQL decode call for a column the runtime cannot resolve to a single `(table, name)` (e.g. an aggregate alias, an `include` aggregate field, a computed projection without a simple ref) receives `ctx.column = undefined`.
- [ ] A SQL encode call (`encodeParams`) receives a `SqlCodecCallContext` with `column = undefined`. A Mongo encode call (`resolveValue`) receives a base `CodecCallContext` (no `column` field).
- [ ] The `ctx.column` value passed to `codec.decode` for a given cell is sourced from the same `ColumnRef` resolution the decode site already performs for `RUNTIME.DECODE_FAILED` envelope construction (no double resolution, no shape drift). The `SqlColumnRef` shape (`{ table, name }`) is a structural projection of `ColumnRef` and the implementation does not allocate it twice per cell when both sites are needed.
- [ ] A codec that ignores `ctx.column` continues to produce identical output to today (verified by regression tests against existing decode fixtures).

## Error envelope

- [ ] `RUNTIME.ABORTED` is added to the runtime error code list in `framework-components/runtime`.
- [ ] The envelope carries `{ phase: 'encode' | 'decode' | 'stream' }` in `details`.
- [ ] The native abort reason (or fallback `DOMException`) is attached on `cause`.
- [ ] If a codec already throws `RUNTIME.ENCODE_FAILED` / `RUNTIME.DECODE_FAILED` because the signal abort surfaced inside the codec body before the runtime detected it, those envelopes pass through unchanged (no double-wrapping).

## Documentation

- [ ] A new ADR (e.g. *ADR 0NN — Codec call context: per-query AbortSignal + column metadata*) documents:
  - The framework `CodecCallContext` shape (signal-only) and the family-extension pattern (`SqlCodecCallContext` adds `column`; Mongo doesn't extend today).
  - The per-`execute` signal contract and the cooperative-cancellation semantics.
  - The `RUNTIME.ABORTED` envelope and `phase` values.
  - The decode-side column-context contract on the SQL family: when `ctx.column` is populated, when it's `undefined`, and why encode-side is the middleware's domain.
  - The walk-back framing: this addition does not preclude later concurrency-cap / bulk-codec / per-instance work.
- [ ] [ADR 204](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) §"Risks & mitigations" is updated with a "Resolved by" pointer to the new ADR for the AbortSignal half. The concurrency-cap half remains "tracked under [TML-2330] / framework-gaps G4."
- [ ] [`docs/reference/framework-gaps.md`](../../docs/reference/framework-gaps.md):
  - G10 (`AbortSignal`) marked "Resolved" with link to the new ADR.
  - G1 (column metadata) marked "Partially resolved (decode-side `(table, name)` plumbed); richer encode-side metadata is the middleware's domain — see *Middleware-driven param transformation*."
  - G4 stays open (concurrency / bulk).

## Walk-back preservation

- [ ] No `TRuntime` generic on `Codec`.
- [ ] No marker / kind / runtime field on the public `Codec` interface.
- [ ] No conditional return types on `encode` / `decode`.
- [ ] No exported sync-vs-async predicates.
- [ ] No `Codec.context` type alias that ties the context shape to async-ness.
- [ ] The codec author surface continues to be framed as "you may write sync or async; the factory accepts both," now with "your function may optionally take a `ctx` second arg."

# Other Considerations

## Security

- The signal is a value from the caller's HTTP handler / business logic; it carries no secrets and is safe to log at envelope level. The `RUNTIME.ABORTED` envelope does not include `wirePreview` or codec input/output (those are encode/decode-failure concerns).
- Forwarding the signal to a codec body lets the codec abort outbound HTTPS calls. For CipherStash specifically, this means an aborted request stops billing/audit-trail accrual at ZeroKMS — a security-relevant property.
- The column-context fields (`table`, `name`) are schema names, not data values; they are not subject to redaction policy.

## Cost

- Per-cell overhead in the no-context case: zero (the ctx parameter is passed by reference; no per-cell allocation; no per-cell readiness checks).
- Per-cell overhead in the column-context case (decode): one allocation for the per-cell `CodecCallContext` object wrapping the shared signal plus the resolved `ColumnRef`. The `ColumnRef` itself is already resolved at the decode site for error wrapping, so the only new allocation is the wrapper.
- Per-cell overhead in the signal-bearing case: one `AbortSignal` listener registration per `Promise.all` (via `abortable(signal)`), released when the `Promise.all` settles.

## Observability

- `RUNTIME.ABORTED` is a new error envelope code; existing telemetry hooks that record envelope codes pick it up automatically.
- No new metrics. A future enhancement could emit "abort observed" telemetry for fleet-level cancellation rates, but it's not required by this project.

## Data Protection

- No new personal-data handling. The error envelope contains no codec input/output values.

## Analytics

- Not applicable.

# References

- [ADR 204 — Single-Path Async Codec Runtime](../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-Path%20Async%20Codec%20Runtime.md) — the runtime shape this project extends; §"Risks & mitigations" names the gap.
- [TML-2330](https://linear.app/prisma-company/issue/TML-2330) — the original Linear ticket. This project is narrower than the ticket sketch (concurrency-cap and `networkBound` trait are intentionally deferred); the ticket's title and description are updated to reflect the narrower landing surface.
- [`docs/reference/framework-gaps.md`](../../docs/reference/framework-gaps.md) — G1 (column metadata, partially resolved here on decode side), G10 (`AbortSignal`, resolved), G4 (concurrency / bulk, deferred); written from the CipherStash integration's perspective.
- [`packages/1-framework/0-foundation/utils/src/abortable.ts`](../../packages/1-framework/0-foundation/utils/src/abortable.ts) — the existing `abortable(signal)` helper used to race `Promise.all` against signal abort.
- [`packages/2-sql/5-runtime/src/codecs/encoding.ts`](../../packages/2-sql/5-runtime/src/codecs/encoding.ts) — `encodeParams` / `encodeParam`, the SQL encode dispatch site.
- [`packages/2-sql/5-runtime/src/codecs/decoding.ts`](../../packages/2-sql/5-runtime/src/codecs/decoding.ts) — `decodeRow` / `decodeField`, the SQL decode dispatch site (already resolves `ColumnRef` per cell).
- [`packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts`](../../packages/3-mongo-target/2-mongo-adapter/src/resolve-value.ts) — the Mongo encode dispatch site.

# Open Questions

None blocking. Items below are deliberate scoping calls captured for completeness:

- **`CodecCallContext` shape today is `{ signal? }` at the framework level; `SqlCodecCallContext` extends it with `{ column? }` at the SQL family.** Future framework-level fields (observability hooks, cancellation reason metadata) and future SQL-level fields (richer column metadata for G1, codec annotations, nullability hints) are anticipated and the shapes are named explicitly so their extension is non-breaking. Adding fields later does not change the codec author surface for existing codecs.
- **Driver-level cancellation** (forwarding signal into the SQL/Mongo driver so an in-flight `pg` query or aggregation pipeline is killed at the connection level) is a follow-up. The codec story stands on its own; driver-level cancellation is its own ticket.
- **Transaction-scoped signal composition.** A future enhancement could let `runtime.transaction({ signal })` create a transaction whose statements inherit cancellation; per-statement signals would compose via `AbortSignal.any([txSignal, stmtSignal])`. Out of scope here.
- **Linear ticket title.** TML-2330's title says "rate limit + AbortSignal"; the rate-limit half is removed from this project's scope. Update the ticket to "Codec call context: per-query AbortSignal + column metadata" or similar; recorded as a project task.
