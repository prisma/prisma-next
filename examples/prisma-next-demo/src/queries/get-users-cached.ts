/**
 * Cached SQL DSL `select` example.
 *
 * Mirrors `get-users.ts` but adds `.annotate(meta => meta.cache(...))`
 * to opt the plan into the cache middleware registered on the runtime
 * in `src/prisma/db.ts`. The `meta` builder is kind-filtered: it only
 * exposes the read-side annotations contributed by the runtime's
 * middleware (`meta.cache` here, contributed by
 * `createCacheMiddleware`). On a write builder (`insert`, `update`,
 * `delete`) `meta.cache` simply doesn't exist — the structural
 * registry filter is the type-level applicability gate, complemented
 * by the runtime check for cast-bypass.
 *
 * The cache key is computed by the runtime via
 * `RuntimeMiddlewareContext.contentHash(exec)` — the post-lowering
 * statement plus parameters, hashed to a bounded SHA-512 digest via
 * the Web Crypto API (so the runtime works on Node and edge runtimes
 * alike). Subsequent calls with the same plan within the TTL window
 * are served from the cache without invoking the driver.
 */
import { db } from '../prisma/db';

export async function getUsersCached(limit = 10, ttlMs = 60_000) {
  const plan = db.sql.user
    .select('id', 'email', 'createdAt', 'kind')
    .annotate((meta) => meta.cache({ ttl: ttlMs }))
    .limit(limit)
    .build();
  return db.runtime().execute(plan);
}
