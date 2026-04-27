import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import { canonicalStringify } from '@prisma-next/utils/canonical-stringify';
import { hashIdentity } from '@prisma-next/utils/hash-identity';

/**
 * Computes a stable identity key for a lowered SQL execution plan.
 *
 * Internally composes three components separated by `|`:
 *
 * 1. `meta.storageHash` — discriminates by schema. A migration changes the
 *    storage hash, which invalidates cached entries automatically.
 * 2. `exec.sql` — the raw lowered SQL text. Two queries with different
 *    structure produce different keys. Note that we deliberately do **not**
 *    use `computeSqlFingerprint` here: that helper strips literals to group
 *    executions by statement shape (used by telemetry), which is the
 *    opposite of what an identity key needs — we want per-execution
 *    discrimination, not per-statement-shape grouping.
 * 3. `canonicalStringify(exec.params)` — a deterministic serialization of
 *    the bound parameters that is stable across object key insertion order
 *    and that distinguishes types JSON would otherwise conflate (e.g.
 *    `BigInt(1)` vs `1`).
 *
 * The composed canonical string is then piped through `hashIdentity` to
 * produce a bounded, opaque digest (see `@prisma-next/utils/hash-identity`
 * for the rationale). The two key reasons for hashing rather than using
 * the canonical string directly:
 *
 * - **Bounded memory.** A query bound to a 10 MB JSON column would
 *   otherwise produce a 10 MB cache key; hashing pins per-key cost at a
 *   fixed digest length regardless of input size.
 * - **Sensitive-data isolation.** Parameter values appear verbatim in the
 *   canonical string; cache keys flow into debug logs, Redis `KEYS`
 *   output, monitoring tools, and user-supplied `CacheStore`
 *   implementations. Hashing prevents PII / credentials / tokens that
 *   appear in query parameters from showing up in those surfaces.
 *
 * @internal
 */
export function computeSqlIdentityKey(exec: SqlExecutionPlan): string {
  return hashIdentity(`${exec.meta.storageHash}|${exec.sql}|${canonicalStringify(exec.params)}`);
}
