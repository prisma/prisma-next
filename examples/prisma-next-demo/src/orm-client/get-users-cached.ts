/**
 * Cached `User.all()` listing.
 *
 * Companion to `find-user-by-id-cached.ts` — same opt-in caching
 * mechanism, this time on a multi-row read terminal. Uses the array
 * escape hatch on `.all(...)` for the same reason: `db.User` here is
 * the custom `UserCollection` subclass and TypeScript can't project
 * the runtime `Registry` into a user-defined class's instance type.
 * See `find-user-by-id-cached.ts` for the long form of that note.
 *
 * The example also shows the per-query `key` override. When set, the
 * supplied string is used verbatim as the cache key; the cache
 * middleware does not rehash it. This is useful for sharing entries
 * across slightly different plans whose results you know to be
 * equivalent (e.g. the same user list rendered through two different
 * `select` shapes), but the trade-off is that you take responsibility
 * for keeping the key bounded and free of sensitive data — the
 * default `contentHash(exec)` digest is a SHA-512 hash (via the Web
 * Crypto API, so the runtime works on edge platforms too) with no
 * such risks.
 */

import { cacheAnnotation } from '@prisma-next/middleware-cache';
import type { Runtime } from '@prisma-next/sql-runtime';
import { createOrmClient } from './client';

export interface CachedListOptions {
  readonly ttlMs?: number;
  /**
   * Optional override for the cache key. When omitted, the runtime's
   * `contentHash(exec)` is used (the default and recommended path).
   */
  readonly key?: string;
}

export async function ormClientGetUsersCached(
  limit: number,
  runtime: Runtime,
  options: CachedListOptions = {},
) {
  const db = createOrmClient(runtime);
  const ttl = options.ttlMs ?? 60_000;
  return db.User.take(limit).all(() => [
    cacheAnnotation(options.key !== undefined ? { ttl, key: options.key } : { ttl }),
  ]);
}
