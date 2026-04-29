import { defineAnnotation } from '@prisma-next/framework-components/runtime';

/**
 * Payload accepted when calling `cacheAnnotation(...)`.
 *
 * - `ttl` — Time-to-live for the cached entry, in milliseconds. When
 *   omitted, the cache middleware passes the query through untouched —
 *   presence of the annotation alone is not sufficient to enable caching.
 *   This makes the cache strictly opt-in per query.
 * - `skip` — When `true`, the cache middleware passes the query through
 *   untouched even if a `ttl` is set. Useful for selectively bypassing
 *   the cache on a per-call basis without removing the annotation
 *   entirely (e.g. a "force refresh" knob in user code).
 * - `key` — Per-query override of the cache key. When supplied, replaces
 *   the default `RuntimeMiddlewareContext.contentHash(exec)` digest.
 *   The supplied string is stored as-is — the cache middleware does
 *   **not** rehash it, so the caller is responsible for ensuring the
 *   string is bounded in size and free of sensitive data they do not
 *   want flowing into logs / Redis `KEYS` / persistence dumps.
 */
export interface CachePayload {
  readonly ttl?: number;
  readonly skip?: boolean;
  readonly key?: string;
}

/**
 * Read-only annotation handle for the cache middleware.
 *
 * Declared with `applicableTo: ['read']`, which gates the structural
 * `AnnotationBuilder<'write', Registry>` filter (so write terminals'
 * `meta` builder simply doesn't expose `meta.cache`) and the runtime
 * `assertAnnotationsApplicable(annotations, 'write', ...)` checks at
 * every lane write terminal — making "cache a mutation" structurally
 * impossible without a cast bypass at both type *and* runtime levels.
 *
 * The handle is registered into the runtime's `AnnotationRegistry` via
 * `createCacheMiddleware`'s `annotations: { cache: cacheAnnotation }`
 * field. Mainline call sites use the registry-driven callback —
 * `.annotate(meta => meta.cache({ ttl: 60_000 }))` — which never needs
 * to import this handle directly. Direct import remains supported for
 * tests, ad-hoc usage, and the array escape hatch on `.annotate(...)`.
 *
 * @example
 * ```typescript
 * import { cacheAnnotation } from '@prisma-next/middleware-cache';
 *
 * // Mainline: registry-driven callback (no import needed at the call site).
 * const user = await db.User.first({ id }, meta => meta.cache({ ttl: 60_000 }));
 *
 * // Array escape hatch (direct handle import):
 * const plan = db.sql
 *   .from(tables.user)
 *   .annotate(() => [cacheAnnotation({ ttl: 60_000 })])
 *   .select({ id: tables.user.columns.id })
 *   .build();
 * ```
 */
export const cacheAnnotation = defineAnnotation<CachePayload, 'read'>({
  name: 'cache',
  applicableTo: ['read'],
});
