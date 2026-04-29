/**
 * Cached `User.first({ id })` lookup.
 *
 * Demonstrates the read-only `cacheAnnotation` from
 * `@prisma-next/middleware-cache`. The annotation is opt-in: the cache
 * middleware only acts on plans whose `meta.annotations` carry a
 * `cacheAnnotation` payload with a `ttl` set. Calling the same lookup
 * with the same `id` within the TTL window is served from the in-memory
 * LRU configured in `src/prisma/db.ts` — the driver is **not** invoked
 * the second time.
 *
 * The cache key is composed by the runtime via
 * `RuntimeMiddlewareContext.contentHash(exec)`, which incorporates the
 * post-lowering SQL plus parameters. Two lookups for different `id`
 * values therefore land in different cache slots; the same `id` hits.
 *
 * Notes worth pinning:
 *
 * - `cacheAnnotation` declares `applicableTo: ['read']`. Passing it to
 *   a write terminal (`create`, `update`, `delete`) is a type error
 *   *and* a runtime error — it cannot be smuggled through with a cast
 *   on one side without failing on the other.
 * - On a cache hit, telemetry's `afterExecute` event reports
 *   `source: 'middleware'`. Telemetry is wired in front of the cache
 *   in `db.ts`, so observability still works for cached reads.
 * - Schema migrations rotate `meta.storageHash`, which feeds
 *   `contentHash`, so cached entries from a previous schema cannot
 *   accidentally serve queries against the new schema.
 */

import { cacheAnnotation } from '@prisma-next/middleware-cache';
import type { DefaultModelRow } from '@prisma-next/sql-orm-client';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Contract } from '../prisma/contract.d';
import { createOrmClient } from './client';

type UserId = DefaultModelRow<Contract, 'User'>['id'];

export interface CachedLookupOptions {
  /**
   * Time-to-live for the cached entry, in milliseconds. Defaults to
   * 60 seconds when not supplied. The cache middleware passes the
   * query through unchanged when `ttl` is omitted from the
   * annotation, so we always set one here.
   */
  readonly ttlMs?: number;
  /**
   * When `true`, the cache middleware passes the query through
   * untouched even if the annotation carries a `ttl`. Useful as a
   * "force refresh" knob without removing the annotation entirely.
   */
  readonly forceRefresh?: boolean;
}

export async function ormClientFindUserByIdCached(
  id: string,
  runtime: Runtime,
  options: CachedLookupOptions = {},
) {
  const db = createOrmClient(runtime);
  const ttl = options.ttlMs ?? 60_000;
  return db.User.first(
    { id: toUserId(id) },
    cacheAnnotation.apply({ ttl, skip: options.forceRefresh ?? false }),
  );
}

function toUserId(value: string): UserId {
  return value as UserId;
}
