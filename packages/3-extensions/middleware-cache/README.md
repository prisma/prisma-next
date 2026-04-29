# @prisma-next/middleware-cache

A family-agnostic, opt-in caching middleware for Prisma Next runtimes.

Built on the `intercept` hook on `RuntimeMiddleware` (added in TML-2143 M1): on a cache hit, the middleware short-circuits execution and returns the cached rows; the driver is never invoked. On a cache miss, the middleware buffers rows from the driver and commits them to the store on successful completion.

The package depends only on `@prisma-next/framework-components/runtime` — no SQL or Mongo runtime dependency. Cache keys come from `RuntimeMiddlewareContext.contentHash(exec)`, which the family runtime populates, so SQL and Mongo runtimes both work out of the box.

## Responsibilities

- Provide an opt-in caching `RuntimeMiddleware` that short-circuits repeated reads via the `intercept` hook. The middleware contributes its `cache` annotation through the `annotations` field on its return value, so `RuntimeCore` registers it into `runtime.annotationRegistry` automatically.
- Define the `cacheAnnotation` handle (read-only, callable) that lane terminals' `.annotate(callback)` callbacks expose as `meta.cache(...)` on read builders, and that direct importers use through the array escape hatch (`() => [cacheAnnotation({ ttl })]`).
- Resolve the cache key per execution: per-query `cacheAnnotation({ key })` override, otherwise `RuntimeMiddlewareContext.contentHash(exec)` from the family runtime.
- Buffer driver rows on a miss and commit to the `CacheStore` only on successful completion (`completed: true && source: 'driver'`).
- Bypass the cache when `RuntimeMiddlewareContext.scope` is `'connection'` or `'transaction'`.
- Ship a default in-memory LRU-with-TTL `CacheStore` and expose the `CacheStore` interface for pluggable backends (Redis, Memcached, etc.).

## Dependencies

- `@prisma-next/framework-components/runtime` — the only production dependency. Provides `RuntimeMiddleware`, `RuntimeMiddlewareContext` (with `contentHash` and `scope`), `defineAnnotation`, `AfterExecuteResult`, and the orchestrator integration via `runWithMiddleware`.

The package does **not** depend on `@prisma-next/sql-runtime`, `@prisma-next/mongo-runtime`, or any target adapter. It does no hashing itself — producing the canonical execution identity is the family runtime's responsibility (via `@prisma-next/utils/hash-identity`, which uses SHA-512 through the Web Crypto API in the SQL and Mongo runtimes today, so the cache stays portable across Node, Bun, Deno, Cloudflare Workers, Vercel Edge, and browsers).


## Quick start

```typescript
import postgres from '@prisma-next/postgres/runtime';
import { createCacheMiddleware } from '@prisma-next/middleware-cache';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const middleware = [createCacheMiddleware({ maxEntries: 1000 })] as const;

const db = postgres<Contract, typeof middleware>({
  contractJson,
  url: process.env['DATABASE_URL']!,
  middleware,
});

// First call: hits the database, caches the raw rows. The `meta`
// builder is structurally typed from the runtime's annotation
// registry, so `meta.cache` is present on read terminals only.
const first = await db.orm.User.first(
  { id: 1 },
  (meta) => meta.cache({ ttl: 60_000 }),
);

// Second call with the identical plan: served from cache, driver
// not invoked.
const second = await db.orm.User.first(
  { id: 1 },
  (meta) => meta.cache({ ttl: 60_000 }),
);

// Un-annotated queries are never cached — caching is strictly opt-in.
const fresh = await db.orm.User.first({ id: 1 }); // always hits the DB
```

> **Note on `as const` / `<typeof middleware>`:** TypeScript captures the
> middleware tuple's literal types only when the user opts in via
> `as const` or `as const satisfies readonly SqlMiddleware[]`, and only
> when the second `Mw` generic on `postgres<...>` is allowed to infer
> the literal tuple. Without it, `Mw` widens to `readonly SqlMiddleware[]`
> and `AnnotationsOf<Mw>` collapses to `{}` — lane terminals' `meta`
> builder will then be empty, and only the array escape hatch will
> work. See `examples/prisma-next-demo/src/prisma/db.ts` for the
> recommended shape.

## Opt-in by annotation

The cache middleware acts only on plans that carry a `cache` annotation payload with a `ttl` set:

| Annotation state | Behavior |
|---|---|
| No `cache` annotation on the plan | Pass through; never cached. |
| `cacheAnnotation({ })` (no `ttl`) | Pass through; never cached. |
| `cacheAnnotation({ skip: true })` | Pass through; never cached. |
| `cacheAnnotation({ ttl })` | Cache lookup; commit on miss + success. |
| `cacheAnnotation({ ttl, key })` | As above, but use the supplied key verbatim. |

The annotation is **read-only**: it declares `applicableTo: ['read']`, so it is structurally absent from `AnnotationBuilder<'write', Registry>` — `meta.cache(...)` on a write terminal is a property-not-found error from the type system. The runtime gate (`assertAnnotationsApplicable`) catches the array-escape-hatch / cast-bypass cases. "Cache a mutation" is structurally impossible without a deliberate cast bypass at both type *and* runtime levels.

```typescript
// ✓ ORM read terminal accepts the read-only annotation through the registry-driven callback.
await db.orm.User.first({ id }, (meta) => meta.cache({ ttl: 60_000 }));

// ✗ Type error: meta.cache is structurally absent from AnnotationBuilder<'write', Registry>.
await db.orm.User.create(input, (meta) => meta.cache({ ttl: 60_000 }));

// ✓ SQL DSL: chainable on select / grouped builders.
const plan = db.sql
  .from(tables.user)
  .select({ id: tables.user.columns.id })
  .annotate((meta) => meta.cache({ ttl: 60_000 }))
  .build();

// ✓ Array escape hatch (direct handle import) — useful when the
// terminal is a custom Collection subclass that doesn't propagate
// the runtime Registry into its instance type.
import { cacheAnnotation } from '@prisma-next/middleware-cache';
await db.orm.User.first({ id }, () => [cacheAnnotation({ ttl: 60_000 })]);
```

## Cache key composition

Two-tier resolution:

1. **Per-query override.** `cacheAnnotation({ key })` — the supplied string is used verbatim. The cache middleware does **not** rehash user-supplied keys; the caller is responsible for keeping the string bounded in size and free of sensitive data they do not want flowing into debug logs, Redis `KEYS` output, persistence dumps, or any user-supplied `CacheStore`.
2. **Default.** `RuntimeMiddlewareContext.contentHash(exec)` — the family runtime owns this. The SQL and Mongo runtimes today compose `meta.storageHash + '|' + …'` and pipe the result through `hashIdentity` (SHA-512 via the Web Crypto API), producing a bounded, opaque digest of the form `sha512:HEXDIGEST`. The cache middleware `await`s the resolved string and uses it directly as the `Map<string, …>` key.

Two consequences worth pinning:

- **Storage-hash discrimination.** A schema migration changes `meta.storageHash`, which changes `contentHash`, which invalidates cached entries automatically. Stale-schema reads cannot leak across migrations.
- **AST rewrites are part of the key.** Middleware that rewrite the plan via `beforeCompile` (e.g. soft-delete) run **upstream** of the cache. The cache sees the post-lowering plan, so the rewritten SQL is part of the content hash. Adding or removing a `beforeCompile` middleware changes which entries hit.

## `CacheStore` pluggability

The default in-memory store is per-process and **not** coherent across replicas. For shared caching, supply a custom `CacheStore`:

```typescript
import type { CacheStore, CachedEntry } from '@prisma-next/middleware-cache';

const redis: CacheStore = {
  async get(key) {
    const raw = await redisClient.get(key);
    return raw ? (JSON.parse(raw) as CachedEntry) : undefined;
  },
  async set(key, entry, ttlMs) {
    await redisClient.set(key, JSON.stringify(entry), 'PX', ttlMs);
  },
};

const middleware = createCacheMiddleware({ store: redis });
```

The interface is intentionally minimal — `get` returns the entry if present and not expired (implementations gating on TTL should treat expired as absent), `set` writes the entry under the key with the per-call `ttlMs`. Both are async to leave room for I/O-backed stores; the default in-memory store completes synchronously and wraps results in `Promise.resolve` for type conformance.

## Transaction-scope guard

The middleware bypasses the cache entirely when `RuntimeMiddlewareContext.scope` is `'connection'` or `'transaction'`. Only top-level `runtime.execute` (`scope === 'runtime'`) consults the store.

This avoids two surprises:

- Inside a transaction, the caller expects read-after-write coherence with their own writes — the cache cannot meaningfully serve those reads without tracking the transaction's pending writes, which is out of scope for this milestone.
- On a checked-out connection (`runtime.connection().execute(...)`), the caller has explicitly stepped outside the shared runtime surface and likely does not expect the global cache to inject results.

## TTL and LRU semantics

The default `createInMemoryCacheStore({ maxEntries, clock? })`:

- **TTL.** Each entry is committed with the per-query `ttl` (in milliseconds). The store evaluates expiry against its injected clock (defaults to `Date.now`); reads of expired entries return `undefined` and drop the entry as a side effect.
- **LRU.** Iteration order is the LRU order. Reads and writes both bump recency. When the live count would exceed `maxEntries`, the oldest entry is evicted.
- **Failure handling.** The middleware commits to the store only when `afterExecute` reports `completed: true && source: 'driver'`. Driver errors mid-stream and middleware-served executions never populate the cache.

## Caveats

- **Default store is not coherent across replicas.** Multiple processes / pods do not share state. Use a custom `CacheStore` (Redis, etc.) for cross-process coherence.
- **Concurrent misses both populate the store.** Two concurrent first-time reads of the same key both run the driver and both commit; last writer wins. Single-flight / coalescing semantics are deferred to a follow-up.
- **Reads of stale-on-arrival entries.** With a custom replicated store, a follower may serve a stale entry for a brief window after the writer commits. Use the storage-hash discrimination plus a sensible TTL.
- **No invalidation beyond TTL.** Entries are not invalidated by writes; tag-based or event-based invalidation is out of scope for this milestone. If a write invalidates a cached read, choose a TTL short enough to bound the staleness window, or pass `cacheAnnotation({ skip: true })` on the read that needs to be authoritative.

## See also

- [Spec](../../../projects/middleware-intercept-and-cache/spec.md) and [plan](../../../projects/middleware-intercept-and-cache/plan.md) for the design rationale and milestone-by-milestone rollout.
- [Runtime & Middleware Framework](../../../docs/architecture%20docs/subsystems/4.%20Runtime%20&%20Middleware%20Framework.md) for the SPI and middleware lifecycle (including the `intercept` hook the cache uses).
- [ADR 204 — Single-tier runtime](../../../docs/architecture%20docs/adrs/ADR%20204%20-%20Single-tier%20runtime.md) for why the cache middleware is family-agnostic by construction.
- `@prisma-next/middleware-telemetry` — companion observability middleware that observes `source: 'driver' | 'middleware'` on `afterExecute` and can be composed alongside the cache.
