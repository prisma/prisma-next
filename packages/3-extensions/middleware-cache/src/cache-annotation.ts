import { defineAnnotation } from '@prisma-next/framework-components/runtime';

/**
 * Payload accepted by `cacheAnnotation.apply(...)`.
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
 *   the default `RuntimeMiddlewareContext.identityKey(exec)` digest.
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
 * Declared with `applicableTo: ['read']`, which gates the type-level
 * `ValidAnnotations<'write', As>` and the runtime
 * `assertAnnotationsApplicable(annotations, 'write', ...)` checks at every
 * lane write terminal — making "cache a mutation" structurally
 * impossible without a `as any` cast bypass at both type *and* runtime
 * levels.
 *
 * Stored under namespace `'cache'` in `plan.meta.annotations`. The cache
 * middleware reads it via `cacheAnnotation.read(plan)`.
 *
 * @example
 * ```typescript
 * import { cacheAnnotation } from '@prisma-next/middleware-cache';
 *
 * // ORM read terminal — accepts the read-only annotation.
 * const user = await db.User.first(
 *   { id },
 *   cacheAnnotation.apply({ ttl: 60_000 }),
 * );
 *
 * // SQL DSL select builder — chainable.
 * const plan = db.sql
 *   .from(tables.user)
 *   .annotate(cacheAnnotation.apply({ ttl: 60_000 }))
 *   .select({ id: tables.user.columns.id })
 *   .build();
 * ```
 */
export const cacheAnnotation = defineAnnotation<CachePayload, 'read'>({
  namespace: 'cache',
  applicableTo: ['read'],
});
