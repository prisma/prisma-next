# ADR 207 — Per-environment facade asymmetry

**Status:** Implemented
**Date:** 2026-05-01
**Domain:** Adapters / Targets, Runtime

## Context

`@prisma-next/postgres` ships a long-lived `postgres()` factory whose returned client closure-caches a `Runtime`, an `orm` client, and a `transaction()` entrypoint. The closure cache is correct for a long-lived Node process: the underlying `pg.Pool` (or singleton `pg.Client`) lives for the lifetime of the process, the runtime threading is amortized, and call sites never have to remember to release anything.

Per-request runtimes — Cloudflare Workers, AWS Lambda (Node), Vercel Edge / Vercel Serverless, Deno Deploy, Bun edge — invert that lifecycle. There is no long-lived process; there is an isolate that handles one or more `fetch` invocations and may be evicted between them. Two properties of the long-lived facade make it unsafe in this shape:

1. The closure-cached `Runtime` (and the `pg.Client` wired into it via the existing `pgClient` driver path — see [ADR 159 — Runtime Driver Lifecycle](ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)) outlives any single `fetch`. After isolate idle, the underlying TCP connection is dead but the cached client object is not. The next request fails with a stale-connection error far from the misconfiguration that caused it.
2. Concurrent `fetch` invocations within the same isolate share the closure. A single `pg.Client` cannot interleave queries; the ones following the first race for the same wire and produce out-of-order or corrupted results. The Node `postgres()` factory mitigates this with `pg.Pool`, but `pg.Pool` is itself a long-lived-process construct (background reaping, idle eviction) and is unsafe to construct fresh per `fetch`.

A `postgresServerless` facade ships alongside `postgres()` for per-request runtimes. It exposes only the static authoring surface (`sql`, `context`, `stack`, `contract`) at module scope, and a `connect(binding) → Promise<Runtime & AsyncDisposable>` entrypoint that constructs a fresh `pg.Client` and returns a fresh `Runtime` per call. There is no closure-cached `orm`, no closure-cached `runtime()`, no `transaction()` member; users construct an ORM client and call `withTransaction(runtime, ...)` against the per-request runtime. The two facades therefore differ in shape, not only in initialization options.

This ADR records the rationale for that asymmetry. The intent is that future per-request runtime + family combinations (Mongo on Lambda, Mongo on Workers, etc.) follow the same pattern, and that future contributors looking at the Node and serverless facades and asking "why don't they look the same" find this document instead of reconstructing the reasoning from `git blame` or the implementation.

## Decision

The shape of the per-request facade differs from the long-lived facade in three concrete ways. Each difference is load-bearing for the lifecycle invariant that the per-request runtime must provide.

### 1. The static authoring surface is shared; the runtime-bound surface is not

Both facades expose `sql`, `context`, `stack`, and `contract` at module scope. These four are pure functions of the contract — the SQL plan-builder is closure-cached over `(context, contract)`; the execution context is closure-cached over `(stack, contract)`; the stack is closure-cached over the descriptors that feed `createSqlExecutionStack`; the contract is the validated input. None of them touch a connection. Caching them per isolate is a pure win.

The long-lived facade additionally caches a `Runtime` (`db.runtime()`), an `orm` client (`db.orm`), and a closure-bound `transaction()` member, all of which thread the cached runtime. The per-request facade does not expose any of those. The runtime-bound surface is acquired per `fetch` via `db.connect(...)`.

### 2. `connect()` returns an `AsyncDisposable` runtime; consumers use `await using`

The per-request facade's `connect({ url })` returns `Promise<Runtime & AsyncDisposable>`. The returned value carries `[Symbol.asyncDispose]` that calls `runtime.close()`, which in turn ends the underlying `pg.Client`. Consumers acquire the runtime with `await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString })` and rely on JavaScript's `using`-style disposal to call `client.end()` on `fetch` return — including on the throw-and-rethrow path.

This is the seam that makes the asymmetry honest. The long-lived `postgres()` facade has no scope at which "the runtime is done"; the per-request facade does — it is the `fetch` body. Encoding that scope as an `AsyncDisposable` returned from `connect()` makes the lifetime visible at every call site and makes it impossible to forget to release the underlying connection.

### 3. ORM and transactions are constructed against the per-request runtime, not closure-cached

Per-request callers construct an ORM client by passing the just-acquired runtime into the existing `createOrmClient(runtime)` pattern (already established in `examples/prisma-next-demo/src/orm-client/`). Transactions run via the existing `withTransaction(runtime, async (tx) => …)` helper from `@prisma-next/sql-runtime`. Both helpers are runtime-parameterized and target-agnostic; the per-request facade uses them unchanged.

The omission is the closure-cached `db.orm` / `db.transaction(...)` members from the long-lived facade. Re-introducing them on the per-request facade would re-introduce the closure cache they depend on, which would re-introduce the stale-connection failure mode the per-request facade exists to prevent.

### 4. Cursor is enabled by default on per-request, disabled by default on long-lived

The long-lived `postgres()` facade defaults `cursor: { disabled: true }` because long-lived consumers often materialize results into containers that benefit from the buffered path's predictability and lower per-row overhead. The per-request facade defaults cursor enabled because the dominant per-request shape — stream a result and return early via `for-await ... break` — is exactly the shape `pg-cursor` is built for, and isolate memory pressure makes buffering a 10k-row result before yielding the first row a foot-gun. Both facades expose a `cursor` option; the default reflects the dominant shape on each side.

## Architecture

### How the facades layer

```
┌────────────────────────────────────────────────────────────┐
│  @prisma-next/postgres                                     │
│                                                            │
│  ┌──────────────────────┐    ┌──────────────────────────┐  │
│  │  postgres()          │    │  postgresServerless()    │  │
│  │  /runtime            │    │  /serverless             │  │
│  │                      │    │                          │  │
│  │  + sql               │    │  + sql                   │  │
│  │  + context           │    │  + context               │  │
│  │  + stack             │    │  + stack                 │  │
│  │  + contract          │    │  + contract              │  │
│  │  + orm               │    │  + connect()             │  │
│  │  + runtime()         │    │      ↓                   │  │
│  │  + transaction()     │    │      Runtime &           │  │
│  │      ↓               │    │      AsyncDisposable     │  │
│  │      cached Runtime  │    │      (fresh per call)    │  │
│  └──────────────────────┘    └──────────────────────────┘  │
│                                                            │
│  Both compose the same execution stack:                    │
│  postgresTarget + postgresAdapter + postgresDriver         │
│  (no driver-layer differences; see ADR 159 for lifecycle)  │
└────────────────────────────────────────────────────────────┘
```

The execution stack underneath both facades is identical. The `postgresDriver` runtime descriptor's `pgClient` binding kind ([ADR 159](ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)) already implements the per-request lifecycle the serverless facade needs: lazy `client.connect()`, no `pg.Pool`, explicit `client.end()`, mutex-serialized `acquireConnection` for transaction affinity. The asymmetry is at the wrapper layer — the driver/target/adapter split below the wrapper is unchanged.

### Construction shape mirrors

```ts
// Long-lived (Node).
const db = postgres<Contract>({
  contractJson,
  url,                  // or `binding`, or `pg`
  extensions: [...],
  middleware: [...],
});

// Per-request (Workers, Lambda, …).
const db = postgresServerless<Contract>({
  contractJson,
  // No connection input here — connection-string is per-request.
  extensions: [...],
  middleware: [...],
});

// Long-lived call site.
const orm = db.orm;
const rows = await orm.User.take(10).all();

// Per-request call site.
export default {
  async fetch(_req, env) {
    await using runtime = await db.connect({ url: env.HYPERDRIVE.connectionString });
    const orm = createOrmClient(runtime);
    const rows = await orm.User.take(10).all();
    return Response.json(rows);
  },
};
```

The construction-shape symmetry (same option keys at the factory boundary) is intentional. The lifecycle-shape divergence (closure-cached vs `connect()`-returned runtime) reflects the actual environment difference. Consumers acknowledge their environment by choosing the import (`@prisma-next/postgres/runtime` vs `@prisma-next/postgres/serverless`); from there, the safe shape is the only shape available.

## Consequences

### Positive

- **The lifecycle is visible at the call site.** `await using runtime = await db.connect(...)` reads as "acquire a runtime for this scope; release it when the scope exits". A reviewer can see that the connection is bounded by the `fetch` body without consulting documentation.
- **Stale-connection failures are structurally impossible.** The per-request runtime cannot outlive its `fetch`; there is no closure to cache it in. An isolate that handles two `fetch` invocations gets two independent runtimes.
- **Concurrent-`fetch` races are structurally impossible.** Each `fetch` constructs its own `pg.Client`. There is no shared mutable state on the per-request path; concurrent invocations within one isolate cannot interleave on the same wire.
- **The ORM-client threading pattern is the same on both sides.** `createOrmClient(runtime)` is the demo's existing pattern; the per-request facade uses it unchanged. Users who learn the pattern on the Node demo carry it forward to Workers / Lambda / Vercel / Deno / Bun without rework.
- **Cursor is on by default where it matters.** The serverless side defaults to streaming because the typical per-request shape benefits; the Node side defaults to buffered for the same reason on its side. Each default reflects the dominant shape on its side.

### Trade-offs

- **The per-request facade is not a drop-in replacement for the Node facade.** Migrating a Node app to a per-request runtime is not "swap one import for another"; it is also "thread `runtime` through every call site that previously used `db.orm` / `db.runtime()` / `db.transaction()`". This is intended — the lifecycle change *is* the migration — but it is a real cost.
- **Two surfaces to document and to keep symmetric.** The construction-shape symmetry has to be maintained by hand; there is no type-level constraint that says "every option key on `postgres()` also appears on `postgresServerless()`". Drift between the two surfaces is an authoring mistake, not a compiler error.
- **No closure-cached `orm` on the per-request side.** Constructing the ORM client per `fetch` is one extra line per route; the cost is negligible (the ORM client is a closure over the runtime, not a heavy object) but it is observable and repeated.

## Alternatives considered

### `AsyncLocalStorage`-based per-request convenience surface

Keep the `db.orm` / `db.transaction(...)` members on the per-request facade. Implement them as accessors that read the "current request's runtime" from an `AsyncLocalStorage` set up at the top of `fetch`.

**Rejected.** Three reasons:

1. The lifecycle is hidden. Call sites read like the Node facade but behave like the per-request facade only if `AsyncLocalStorage` is correctly threaded. Forgetting to set up the ALS context surfaces as a runtime error far from the cause.
2. It adds a load-bearing dependency on `node:async_hooks` semantics — fine on Node and on Workers under `nodejs_compat`, but the polyfill story is not uniformly good across per-request runtimes (Bun, Deno Deploy, edge runtimes that disable Node-compat shims).
3. It dilutes the design intent. The whole point of the per-request facade is to make the per-request lifecycle *explicit* and *visible*. ALS exists to make context *implicit* and *invisible*. The two are at odds.

### Single facade with per-call disposable runtime

Keep one `postgres()` factory; make it return a runtime that is *always* per-call. Drop the closure-cached `orm` / `runtime()` / `transaction(...)` from Node too, and have Node consumers also write `await using runtime = await db.connect(...)` per request.

**Rejected.** Two reasons:

1. The Node ergonomic regression is real and not warranted by Node's actual lifecycle. Long-lived processes legitimately want a closure-cached runtime; making them re-acquire one per request adds connection-pool churn (or, if `pg.Pool` is used, a layer of indirection that obscures the pooling story) for no safety gain.
2. It would be a breaking change to every existing Node consumer, with no migration story other than "rewrite every route handler". The closure-cached convenience surface is the dominant Node usage pattern in the existing demo and in user code; collapsing both shapes into one is not worth the disruption.

The asymmetry is the right shape. Each side gets the API that fits its lifecycle.

### Per-product facades (`postgresWorkers`, `postgresLambda`, …) instead of the per-environment-class `postgresServerless`

Ship one facade per per-request product (Cloudflare Workers, AWS Lambda, Vercel Edge, Vercel Serverless, Deno Deploy, Bun edge). Each could carry product-specific ergonomics — `postgresWorkers({ hyperdrive: env.HYPERDRIVE })` instead of `postgresServerless({ contractJson }) ... db.connect({ url: env.HYPERDRIVE.connectionString })`.

**Rejected.** Two reasons:

1. The product-specific ergonomic is shallow. Every per-request runtime exposes "a connection string from somewhere" — `env.HYPERDRIVE.connectionString` on Workers, `process.env.DATABASE_URL` on Lambda, `Deno.env.get('DATABASE_URL')` on Deno, etc. Wrapping each one in a bespoke factory just to skip the `.connectionString` field access trades a generic surface for N near-identical surfaces with N maintenance footprints.
2. The lifecycle invariants are uniform across products. Per-request is per-request whether the host is Workers or Lambda. Making the API shape-track product instead of lifecycle would invite product-specific lifecycle drift over time.

The per-environment-class shape (one facade, one shape, sourced URL) reflects the actual invariant. Cloudflare Workers + Hyperdrive is the primary tested + documented path; the rest follow from the same facade.

### Drop the convenience surface from `postgres()` (Node) too

Keep one facade but force every Node consumer to write `await using runtime = await db.connect(...)` per request, citing "consistency with the per-request side".

**Rejected for the same reasons as the single-facade alternative above.** Long-lived processes do not benefit from per-call runtime acquisition; the convenience surface stays on the Node side.

## Interaction with other ADRs

- **[ADR 159 — Runtime Driver Lifecycle](ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md)** defines the unbound → connected lifecycle of `SqlDriver` and the `pgClient` `PostgresBinding` kind. The per-request facade uses that lifecycle unchanged: it constructs a fresh `pg.Client` per `connect()` call and routes through the existing `pgClient` binding. No new binding kinds are needed.
- **[ADR 155 — Driver/Codec Boundary and Lowering Responsibilities](ADR%20155%20-%20Driver%20Codec%20Boundary%20and%20Lowering%20Responsibilities.md)** governs the codec/driver/lowering split. Both facades sit above that split and inherit it; the asymmetry is wrapper-level, not driver-level.
- **[ADR 152 — Execution Plane Descriptors and Instances](ADR%20152%20-%20Execution%20Plane%20Descriptors%20and%20Instances.md)** defines the descriptor/instance pattern that both facades compose (`postgresTarget + postgresAdapter + postgresDriver`). The execution stack is the same on both sides.

## Decision record

The `@prisma-next/postgres` package ships two facades with a deliberately asymmetric surface. The static authoring surface (`sql`, `context`, `stack`, `contract`) is identical on both sides; the runtime-bound surface differs. The Node `postgres()` facade closure-caches a long-lived `Runtime`, an `orm` client, and a `transaction()` entrypoint. The per-request `postgresServerless()` facade exposes a `connect(binding) → Promise<Runtime & AsyncDisposable>` entrypoint and omits the closure-cached members. Cursor defaults differ to reflect the dominant per-side shape (off on Node, on for serverless); both sides expose a `cursor` option for parity. The two facades compose the same `postgresTarget + postgresAdapter + postgresDriver` stack and inherit the lifecycle defined by [ADR 159](ADR%20159%20-%20Driver%20Terminology%20and%20Lifecycle.md). Future per-request facades (other targets / families) follow the same pattern: shared static surface, `connect()`-returned `AsyncDisposable` runtime, no closure-cached convenience members.
