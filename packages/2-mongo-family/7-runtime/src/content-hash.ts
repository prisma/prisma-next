import { canonicalStringify } from '@prisma-next/utils/canonical-stringify';
import { hashContent } from '@prisma-next/utils/hash-content';
import type { MongoExecutionPlan } from './mongo-execution-plan';

/**
 * Computes a stable content hash for a lowered Mongo execution plan.
 *
 * Internally builds an unambiguous canonical-stringified preimage from
 * two components:
 *
 * 1. `meta.storageHash` — discriminates by schema. A migration changes the
 *    storage hash, which invalidates cached entries automatically (no
 *    per-app invalidation logic needed for schema changes).
 * 2. `exec.command` — the wire command. `canonicalStringify` produces a
 *    deterministic serialization that is stable across object key
 *    insertion order and that distinguishes types JSON would otherwise
 *    conflate (e.g. `BigInt(1)` vs `1`, `Date` vs ISO string, `Buffer`
 *    vs number array). The spread converts the frozen wire-command
 *    class instance (`InsertOneWireCommand`, `AggregateWireCommand`, …)
 *    into a plain object exposing its own enumerable properties
 *    (`kind`, `collection`, plus the payload-specific fields like
 *    `document`/`filter`/`update`/`pipeline`/…), which is what
 *    `canonicalStringify` accepts; class instances are rejected
 *    outright to prevent silent collisions.
 *
 * Unlike SQL, there is no separate "rendered statement" component because
 * a Mongo `MongoExecutionPlan.command` is the wire command itself —
 * canonicalizing it captures both structure and parameters in one pass.
 *
 * The components are wrapped in an object and canonicalized as a single
 * unit (rather than concatenated with a delimiter) so component
 * boundaries are unambiguous and cannot collide with a different split
 * of the same characters.
 *
 * The canonical string is then piped through `hashContent` to produce a
 * bounded, opaque digest (see `@prisma-next/utils/hash-content` for the
 * rationale). The two key reasons for hashing rather than using the
 * canonical string directly:
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
export function computeMongoContentHash(exec: MongoExecutionPlan): Promise<string> {
  // Spread `exec.command` to a plain object: `canonicalStringify`
  // rejects class instances by design (so `Map`/`Set`/class instances
  // cannot collapse to `{}` and silently collide). All wire-command
  // data lives on own enumerable properties, so this preserves the
  // same canonical form and therefore the same hash.
  return hashContent(
    canonicalStringify({
      storageHash: exec.meta.storageHash,
      command: { ...exec.command },
    }),
  );
}
