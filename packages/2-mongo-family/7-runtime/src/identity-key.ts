import { canonicalStringify } from '@prisma-next/utils/canonical-stringify';
import { hashIdentity } from '@prisma-next/utils/hash-identity';
import type { MongoExecutionPlan } from './mongo-execution-plan';

/**
 * Computes a stable identity key for a lowered Mongo execution plan.
 *
 * Internally composes two components separated by `|`:
 *
 * 1. `meta.storageHash` — discriminates by schema. A migration changes the
 *    storage hash, which invalidates cached entries automatically (no
 *    per-app invalidation logic needed for schema changes).
 * 2. `canonicalStringify(exec.command)` — a deterministic serialization of
 *    the wire command that is stable across object key insertion order
 *    and that distinguishes types JSON would otherwise conflate (e.g.
 *    `BigInt(1)` vs `1`, `Date` vs ISO string, `Buffer` vs number array).
 *
 * Unlike SQL, there is no separate "rendered statement" component because
 * a Mongo `MongoExecutionPlan.command` is the wire command itself —
 * canonicalizing it captures both structure and parameters in one pass.
 *
 * The composed canonical string is then piped through `hashIdentity` to
 * produce a bounded, opaque digest (see `@prisma-next/utils/hash-identity`
 * for the rationale). The two key reasons for hashing rather than using
 * the canonical string directly:
 *
 * - **Bounded memory.** A command embedding a large document (binary blob,
 *   large nested payload) would otherwise produce a proportionally large
 *   cache key; hashing pins per-key cost at a fixed digest length
 *   regardless of input size.
 * - **Sensitive-data isolation.** Document and filter values appear
 *   verbatim in the canonical string; cache keys flow into debug logs,
 *   Redis `KEYS` output, monitoring tools, and user-supplied `CacheStore`
 *   implementations. Hashing prevents PII / credentials / tokens that
 *   appear in command payloads from showing up in those surfaces.
 *
 * @internal
 */
export function computeMongoIdentityKey(exec: MongoExecutionPlan): string {
  return hashIdentity(`${exec.meta.storageHash}|${canonicalStringify(exec.command)}`);
}
