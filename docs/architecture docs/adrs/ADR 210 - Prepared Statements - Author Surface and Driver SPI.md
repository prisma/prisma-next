# ADR 210 — Prepared Statements: Author Surface and Driver SPI

## Status

Accepted. May 5, 2026.

Adds an explicit, user-owned prepared statement to the SQL DSL via `db.sql.$prepare(declaration, callback)`. The returned `PreparedStatement<Params, Row>` carries the lowered SQL once, and on first execute the driver lazily allocates an opaque handle and stores it back on the statement through a slot wrapper. The runtime never inspects the handle; the driver chooses its shape, its allocation moment, and its connection-scoped lifetime. There is no global cache — cache lifetime equals the user's reference to the `PreparedStatement`, bounded by the lifetime of the connection that holds the underlying server-side state.

This ADR is family-level: it pins the author surface, the SPI, and the lifetime model. Per-driver caching strategies and per-driver stale-detection mechanics live in the drivers themselves, not here.

## Grounding example

The author surface is two functions on `db.sql` and one method on the returned object:

```ts
const ps = await db.sql.$prepare(
  { userId: 'int4@1', email: 'text@1' },
  (sql, params) =>
    sql.user
      .update({ email: params.email })
      .where((f, fns) => fns.eq(f.id, params.userId))
      .build(),
);

await ps.execute({ userId: 124, email: 'carl@example.com' });
await ps.execute({ userId: 125, email: 'dee@example.com'  });
```

`$prepare` lowers the AST exactly once and freezes the lowered SQL on the `PreparedStatement`. On first `.execute()`, the driver allocates a handle of its own choosing and stores it back on the statement; subsequent executes reuse it. Without `$prepare`, ad-hoc `db.sql.from(...).execute()` retains its current behaviour and does not participate in any cache.

That is the entire user-visible surface. Everything below explains how it composes.

## Decision

Three load-bearing choices:

- **The primitive is a user-owned, explicit handle.** `$prepare` returns a `PreparedStatement` whose lifetime is the user's reference. There is no global cache, no automatic deduplication, and no shape-keyed lookup. Reuse is opt-in: users call `$prepare` exactly when they want it. Two `$prepare` calls with identical SQL produce two handles.
- **Cache lifetime equals the user's reference, bounded by connection lifetime.** The `PreparedStatement` carries the lowered SQL and (lazily) one opaque handle. Server-side state lives on the connection; when the connection ends, that state ends with it. There is no dispose path.
- **Driver allocates the handle, runtime never inspects it.** The runtime hands the driver a `{ sql, params, handle }` request where `handle` is a getter/setter slot. The driver mints whatever shape it likes — and at whatever moment makes sense for that target — and writes it back. The runtime treats the slot's value as opaque. This keeps the runtime agnostic to per-target preparation mechanics, and lets the SPI stay invariant across targets that have very different reuse primitives.

Everything else — the `$` prefix, the async-no-I/O contract, the stale-handle retry contract, the pooler opt-out — falls out from these three choices.

## Author surface

### `db.sql.$prepare(declaration, callback)`

`declaration` is a name-keyed object whose values are codec-id strings drawn from the codec registry, with editor autocomplete and compile-time validation. The long form (`{ codecId, nullable: true }`) is used when nullability differs from the default. `Params` for `.execute(params)` is derived from the declaration via each codec's `TInput` mapping, threading nullability through.

`callback` receives `(sql, params)` where each `params.<name>` is a bind-site reference usable wherever a literal would normally appear — `eq`, `update`, `where` predicates, anywhere the existing `CodecExpression` union accepts a value. The TS type of `params.userId` inside the callback is `Expression<{ codecId; nullable }>`, i.e. the same `Expression<ScopeField>` arm of `CodecExpression` that the rest of the DSL already accepts. The codec's `TInput` mapping flows through separately to the runtime argument of `ps.execute({...})`. Slot reuse is implicit: referencing `params.userId` twice produces one slot used twice. Literals not threaded through `params` are baked into the lowered SQL at lower-time.

The callback MUST end with `.build()`; `Row` is derived from the returned plan's row type. If a name in `declaration` is not referenced by the returned plan, `$prepare` throws a stable error code under the `RUNTIME` namespace. (Type-level detection of unused declared params is not achievable across the chained-builder type machinery; runtime detection is the contract.)

### Why the `$` prefix

`db.sql` is a proxy that maps top-level keys to user-defined tables. PSL identifiers cannot start with `$`, so `$prepare` cannot collide with any user-defined table name in any current or future contract. The same prefix is available for any future framework-level method that has to live on the same proxy.

### Why `$prepare` is async with no driver I/O

`$prepare` performs no driver I/O. It invokes the callback, awaits the existing async `beforeCompile` middleware chain on the resulting plan's AST so AST rewrites are baked into the lowered SQL, calls the adapter's `lower()`, and freezes the lowered SQL plus parameter slot order onto the `PreparedStatement`. The handle slot starts unset.

The async return reflects an existing constraint, not a new one. `beforeCompile` is async-typed today; making `$prepare` sync-callable would force us to either freeze that hook chain into a different surface or run it differently for prepared vs. ad-hoc paths. Both options trade an artificial constraint for a future migration cost. Keeping the chain intact and returning `Promise<PreparedStatement<Params, Row>>` costs one `await` at call sites and preserves the symmetry between ad-hoc and prepared executions. Driver I/O still happens only on `.execute()`.

### Capability gating

`$prepare` is available on every SQL target with no contract capability flag. The lowering-reuse benefit is universal — every adapter's `lower()` is pure work that can be cached. The server-side reuse benefit is opportunistic: the driver may or may not deliver it, and may be told not to via the per-driver opt-out described below. Gating `$prepare` on a capability would force users to inspect the contract before deciding whether to call a method whose API is identical regardless. We expose the call unconditionally and let the driver decide what to do underneath.

## Driver SPI

`SqlQueryable` gains one method:

```ts
interface PreparedExecuteRequest {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly handle: { get(): unknown | undefined; set(value: unknown): void };
}

interface SqlQueryable {
  // … existing methods …
  executePrepared(req: PreparedExecuteRequest): AsyncIterable<Row>;
}
```

The driver receives the lowered SQL, encoded params, and a slot wrapper — never the `PreparedStatement` object. The runtime constructs the slot wrapper around the `PreparedStatement`'s handle field; reads and writes flow through that single field on the user's object.

### Lazy handle allocation

The slot starts unset. On each call, the driver decides whether to allocate. The expected pattern, with no preparation today, is: read `req.handle.get()`; if undefined, mint a handle of the driver's choosing and call `req.handle.set(handle)`; thereafter, reuse the handle on subsequent calls against connections where the underlying server-side prepared statement is still valid.

Handle shape is the driver's choice and opaque to the runtime. The runtime never branches on the handle's shape, never logs it, and never compares two handles for equality. Allocation MUST be cheap and synchronous (the call sits inside an async-iterable execute, and the framework guarantees no I/O cost for handle allocation itself). Beyond that, the driver is free.

### Why a slot wrapper

Pinning the driver's contact surface to a three-field record keeps the SPI minimal. Drivers cannot reach into the `PreparedStatement` to inspect declarations, ASTs, or middleware state, even by accident. The runtime owns the rest of the object and can evolve it (additional middleware metadata, debug fields) without touching the driver SPI. The slot pattern also means a driver that does not yet implement server-side reuse can return correct results without ever touching the slot — `executePrepared` becomes a one-shot parameterized query that ignores `req.handle`. The SPI shape is the same; only the body changes.

## Reuse lifetime

The `PreparedStatement` carries the lowered SQL and (lazily) one handle. Server-side state — whatever the driver maintains to make subsequent executes cheaper — lives on the connection. When the connection ends, that state ends with it. No driver is asked to coordinate state across connections, and no driver is asked to retain state past connection lifetime.

A `PreparedStatement` reused across two connections may end up with handles that are byte-identical or distinct, depending on what the driver finds convenient. The runtime makes no claims either way, and code that consumes a `PreparedStatement` MUST NOT depend on either property.

Memory bound: `(distinct PreparedStatements) × (live connections that have executed each)`, sized in low KB per pair. Long-lived connections holding many `PreparedStatement` references will accumulate prepared-statement memory until the connection recycles. NFR2 in the spec calls this out as expected behaviour.

## Stale-handle retry

Server-side prepared statements outlive any single `.execute()` call. A migration that changes a column's type, an administrative reset, or a connection-internal eviction can leave a cached prepared statement out of sync with the server's view. The framework-level contract is symmetric across drivers:

- The driver detects the staleness signal — its mechanism, its detection sensitivity.
- On detection, the driver clears the slot and allocates a fresh handle (i.e. calls `req.handle.set(newHandle)` with a new value).
- The driver retries the execute exactly once.
- On success, the user observes one `.execute()` call that succeeded.
- On retry failure, the driver surfaces `ADAPTER.PREPARE_FAILED` (see [ADR 027](./ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md) §ADAPTER), preserving the originating error as `cause`.

Detection sensitivity is a per-driver tradeoff. Some targets surface a clean signal that says "this prepared statement is gone"; the driver retries narrowly. Others have no such signal; the driver may treat any error originating from a cached execution as a candidate for re-prepare. In the second case the false-positive cost is one extra preparation, paid only on otherwise-failing executes — the bound is small and self-correcting. The framework neither prefers nor mandates either policy; it pins the contract (clear, allocate, retry once, surface) and leaves the trigger to the driver.

The runtime never re-lowers on retry. The lowered SQL on the `PreparedStatement` is invariant for the lifetime of the statement; only the handle changes.

## Reuse opt-out: `preparedStatements: boolean`

Some deployment topologies cannot rely on server-side prepared-statement persistence — for example, transaction-mode connection multiplexers or pooling proxies that may switch the underlying physical connection between calls. Whether server-side reuse is safe is a topology question, not a target-version question, so neither the contract nor the driver tries to auto-detect it.

The supported escape hatch is an explicit driver option: `preparedStatements: boolean`, default `true`. When the option is `false`, `executePrepared` runs a one-shot parameterized query and leaves the handle slot unset. The lowered SQL on the `PreparedStatement` is still reused — that is the universal half of the benefit, independent of server-side preparation. Users keep the lowering reuse and lose the parse-skip; the tradeoff is explicit.

The driver does not auto-detect topology. Auto-detection is unreliable (greeting strings vary, transparent proxies exist) and shifts a correctness decision from configuration to heuristics. Users opt out explicitly and own the decision.

## Middleware

Three hooks fire on the prepared path; one fires earlier than on the ad-hoc path:

- `beforeCompile` runs **once at `$prepare` time**. AST rewrites change the lowered SQL, so they have to be baked in before the SQL is frozen on the `PreparedStatement`. Re-running per execute would defeat the cache — every execute would have to re-lower.
- `beforeExecute`, `onRow`, `afterExecute` run **per `.execute()` call**. They observe params and rows, which differ per execute, and never see the lowered SQL changing.

Ad-hoc `.execute()` is unchanged: all four hooks run as today. The single asymmetry — `beforeCompile` running at prepare time vs. execute time — is the irreducible consequence of caching the lowered SQL.

## Out-of-process and out-of-driver state

The `PreparedStatement` carries no parameter values, no row data, and no SQL secrets — only the lowered SQL text and (lazily) the opaque handle. Server-side prepared statements persist on the connection until the connection ends. There is no dispose path. With no dispose, security-sensitive cleanup is force-recycling pool connections; this is the same posture every other connection-scoped resource has today.

## Non-goals

- **Global shape cache.** Two `$prepare` calls with identical SQL produce two handles. Deduplication is the user's responsibility — they hold the reference, they decide whether to reuse it. A global cache would invert ownership and force lifetime decisions onto the framework.
- **Cross-process or persistent caches.** All state is in-process and tied to live connections.
- **Cross-adapter reuse.** A `PreparedStatement` is bound to the SQL DSL it was created from. The surface is SQL-only; non-SQL families do not have a `$prepare` semantic.
- **Explicit dispose.** No `.dispose()` method. The leak is bounded and self-heals on connection recycle. A dispose method would require tracking which connections have seen which handles, which is the cache we explicitly chose not to build.
- **Pre-warming server-side preparation at pool init.** First `.execute()` per connection pays the preparation cost. Pre-warming would require the framework to know the full set of `PreparedStatement`s ahead of time; the user-owned-handle model puts that knowledge on the user.
- **Observability surface for prepared-statement execution.** Tracing, metrics, counters, structured logs — out of scope for v1. Drivers may add their own.
- **List/array parameter types.** The framework has no list codecs at this time, so `$prepare` does not support array-typed slots. Once list codecs exist, prepared-statement support for array slots is automatic.

## Alternatives considered

**A. Implicit / shape-keyed global cache.** Lowering happens automatically the first time a given AST is executed; subsequent identical ASTs reuse the lowered SQL. Rejected. Cache invalidation becomes a framework problem (how big? what eviction policy? what about middleware that mutates the AST per call?), and the win is opaque to users — they cannot tell whether a given call is hot or cold without instrumentation. The user-owned handle keeps lifetime where it can be reasoned about: at the call site.

**B. `$prepare` returns synchronously.** Considered. Would require either splitting `beforeCompile` into sync and async variants or running middleware lazily on first execute. The first inflates the hook surface; the second defeats the "no I/O at prepare time" property by deferring middleware work into the I/O path. Async return matches the existing chain and costs one `await`.

**C. Driver receives the `PreparedStatement` directly.** Rejected. Pins the driver's contact surface to the entire object, which carries declarations, callback closure references, AST metadata, and middleware state. The slot-wrapper SPI keeps the surface to three fields and lets the runtime evolve the rest of the object freely. It also means a driver that does not yet implement server-side reuse can route through the same SPI by ignoring the slot — the same shape that the `preparedStatements: false` opt-out produces.

**D. Auto-detect topologies that do not support server-side reuse.** Rejected. Detection is unreliable across deployment topologies. Misdetecting in either direction is worse than asking users to flip a flag once: a false positive disables a real optimisation; a false negative causes runtime errors deep inside hot loops. The explicit option puts the decision where the deployment topology is known.

**E. Allocate the driver handle at `$prepare` time.** Rejected. Forces driver I/O into a method whose contract is "no I/O", and mints handles for connections the statement may never reach. Lazy allocation on first execute matches the lifetime of the underlying server-side state and keeps `$prepare` cheap, sync-shaped, and idempotent.

**F. Mandate a single stale-detection policy across drivers.** Rejected. The detection signal is target-specific; the framework's job is to pin the contract (clear, allocate, retry once, surface), not to legislate a detection mechanism a target may not be able to provide. Symmetric policy at the contract level, asymmetric policy at the trigger level.

## Cross-references

- [ADR 016 — Adapter SPI for Lowering](./ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md) — `executePrepared` is the natural extension of the adapter SPI; `lower()` is invoked once at `$prepare` time and never again on the prepared path.
- [ADR 027 — Error Envelope Stable Codes](./ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md) — `ADAPTER.PREPARE_FAILED` is the surface for retry failures during cached-statement re-execution.
- [ADR 205 — SQL cast emission is adapter policy](./ADR%20205%20-%20SQL%20cast%20emission%20is%20adapter%20policy.md) — Adapter-policy casting cooperates with prepared-statement reuse: a cached prepared statement keeps its parameter types stable across executes, so unconditional casts are not required for correctness on the prepared path. The "always cast everything" pivot in ADR 205 §Consequences remains a one-line change.
