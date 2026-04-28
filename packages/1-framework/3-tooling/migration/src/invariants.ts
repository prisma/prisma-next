import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { errorDuplicateInvariantInEdge, errorInvalidInvariantId } from './errors';
import type { MigrationOps } from './package';

/**
 * Hygiene check for `invariantId`. Rejects empty values plus any
 * whitespace or control character (including Unicode whitespace like
 * NBSP and em space, which are visually identical to ASCII space and
 * routinely sneak in via paste).
 */
export function validateInvariantId(invariantId: string): boolean {
  if (invariantId.length === 0) return false;
  return !/[\p{Cc}\p{White_Space}]/u.test(invariantId);
}

/**
 * Walk a migration's operations and produce its `providedInvariants`
 * aggregate: the sorted, deduplicated list of `invariantId`s declared
 * by data-transform ops. Ops without `operationClass === 'data'` are
 * skipped; data ops without an `invariantId` are skipped.
 *
 * Throws `MIGRATION.INVALID_INVARIANT_ID` on a malformed id and
 * `MIGRATION.DUPLICATE_INVARIANT_IN_EDGE` on duplicates.
 */
export function deriveProvidedInvariants(ops: MigrationOps): readonly string[] {
  const seen = new Set<string>();
  for (const op of ops) {
    const invariantId = readInvariantId(op);
    if (invariantId === undefined) continue;
    if (!validateInvariantId(invariantId)) {
      throw errorInvalidInvariantId(invariantId);
    }
    if (seen.has(invariantId)) {
      throw errorDuplicateInvariantInEdge(invariantId);
    }
    seen.add(invariantId);
  }
  return [...seen].sort();
}

function readInvariantId(op: MigrationPlanOperation): string | undefined {
  if (op.operationClass !== 'data') return undefined;
  const candidate = (op as { invariantId?: unknown }).invariantId;
  return typeof candidate === 'string' ? candidate : undefined;
}
