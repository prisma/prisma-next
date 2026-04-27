import { createHash } from 'node:crypto';

/**
 * Hashes a canonical-string representation of an execution into a bounded,
 * opaque cache-key digest.
 *
 * Designed for use as the final step of `RuntimeMiddlewareContext.identityKey`
 * implementations: family runtimes compose a canonical string from
 * `meta.storageHash`, the rendered statement (or wire command), and
 * canonicalized parameters via `canonicalStringify`, then pipe the result
 * through this helper.
 *
 * Why hash the canonical string instead of using it directly as a `Map` key:
 *
 * 1. **Bounded memory.** A raw canonical key includes concrete parameter
 *    values, so a query bound to a 10 MB JSON column or binary blob produces
 *    a 10 MB cache key. With `maxEntries = 1000`, that scales to gigabytes
 *    of cache keys alone. BLAKE2b-512 pins per-key cost at a fixed digest
 *    length regardless of input size.
 *
 * 2. **Sensitive-data isolation.** The canonical string contains parameter
 *    values verbatim. Cache keys flow into debug logs, Redis `KEYS`/`MONITOR`
 *    output, persistence dumps, monitoring tools, and any user-supplied
 *    `CacheStore` implementation. Hashing prevents PII / credentials /
 *    tokens that appear in query parameters from showing up in any of those
 *    surfaces.
 *
 * Algorithm choice — BLAKE2b-512 (`blake2b512` in Node's `crypto` module):
 *
 * - **Speed.** BLAKE2b is faster than SHA-256 on modern hardware (designed
 *   to outperform MD5/SHA-1/SHA-2/SHA-3 on 64-bit platforms while remaining
 *   cryptographically strong).
 * - **Collision space.** 512 bits of output makes accidental collisions
 *   astronomically improbable — far beyond what a cache needs, but the
 *   incremental cost over 256-bit output is negligible and the headroom
 *   is free.
 * - **Stdlib.** No additional dependency.
 *
 * Output format: `blake2b512:HEXDIGEST` (128-char hex with the algorithm
 * tag prefix). Self-describing so a future migration to a different hash
 * produces visibly distinct keys, and consistent with the
 * `sha256:HEXDIGEST` shape already used by `meta.storageHash`.
 *
 * @example
 * ```typescript
 * const canonical = `${exec.meta.storageHash}|${exec.sql}|${canonicalStringify(exec.params)}`;
 * return hashIdentity(canonical);
 * // → 'blake2b512:8f3...e1c' (always 137 chars: 'blake2b512:' + 128 hex chars)
 * ```
 */
export function hashIdentity(value: string): string {
  return `blake2b512:${createHash('blake2b512').update(value).digest('hex')}`;
}
