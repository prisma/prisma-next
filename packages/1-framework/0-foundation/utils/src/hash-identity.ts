/**
 * Hashes a canonical-string representation of an execution into a bounded,
 * opaque cache-key digest.
 *
 * Designed for use as the final step of `RuntimeMiddlewareContext.contentHash`
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
 *    of cache keys alone. SHA-512 pins per-key cost at a fixed digest length
 *    regardless of input size.
 *
 * 2. **Sensitive-data isolation.** The canonical string contains parameter
 *    values verbatim. Cache keys flow into debug logs, Redis `KEYS`/`MONITOR`
 *    output, persistence dumps, monitoring tools, and any user-supplied
 *    `CacheStore` implementation. Hashing prevents PII / credentials /
 *    tokens that appear in query parameters from showing up in any of those
 *    surfaces.
 *
 * Algorithm choice — SHA-512 via the Web Crypto API (`crypto.subtle.digest`):
 *
 * - **Portability.** Works on every JavaScript runtime that matters:
 *   Node.js, Bun, Deno, Cloudflare Workers, Vercel Edge, browsers. The
 *   Web Crypto API only exposes the SHA-1/256/384/512 family, so SHA-512
 *   is the strongest portable option. BLAKE2 is a Node-only stdlib choice
 *   and would force a pure-JS implementation on edge runtimes.
 * - **Native backing.** Every runtime implements SHA-512 against its
 *   underlying TLS / crypto library (BoringSSL, OpenSSL, etc.), often
 *   with hardware acceleration where available.
 * - **Collision space.** 512 bits of output makes accidental collisions
 *   astronomically improbable — far beyond what a cache needs.
 *
 * The function is async because `crypto.subtle.digest` is async on every
 * runtime. `RuntimeMiddlewareContext.contentHash` is async to match.
 *
 * Output format: `sha512:HEXDIGEST` (128-char hex with the algorithm tag
 * prefix). Self-describing so a future migration to a different hash
 * produces visibly distinct keys, and consistent with the
 * `sha256:HEXDIGEST` shape already used by `meta.storageHash`.
 *
 * @example
 * ```typescript
 * const canonical = `${exec.meta.storageHash}|${exec.sql}|${canonicalStringify(exec.params)}`;
 * return hashIdentity(canonical);
 * // → 'sha512:8f3...e1c' (always 135 chars: 'sha512:' + 128 hex chars)
 * ```
 */
export async function hashIdentity(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const buffer = await crypto.subtle.digest('SHA-512', bytes);
  const view = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i]!.toString(16).padStart(2, '0');
  }
  return `sha512:${hex}`;
}
