import { createHash } from 'node:crypto';

export type RlsPolicyOperation = 'select' | 'insert' | 'update' | 'delete' | 'all';

export interface ContentHashParts {
  readonly using?: string;
  readonly withCheck?: string;
  readonly roles: readonly string[];
  readonly operation: RlsPolicyOperation;
  readonly permissive: boolean;
}

/**
 * Stabilizes an authored predicate for hashing: trim, and collapse runs of
 * internal whitespace to a single space.
 *
 * This is deliberately minimal. The content hash is the equivalence relation
 * for a policy, and the wire name (prefix + hash) is the only thing ever
 * compared — we never recompute the hash from an introspected policy body, so
 * there is no need to match Postgres's reprinted form. Minimal normalization
 * also protects the no-collision property: aggressive rewriting (lowercasing,
 * paren-stripping, cast-alias folding) risks collapsing two distinct predicates
 * onto one hash. Out-of-band alteration of a hashed policy is unsupported.
 *
 * The normalizer is a stability commitment: any change re-suffixes all wire names.
 */
export function normalizePredicate(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

/**
 * Returns the first 8 lowercase hex characters of the SHA-256 digest over the
 * canonical content tuple for an RLS policy:
 *
 *   [normalize(using), normalize(withCheck), sortedRoles, operation, permissive]
 *
 * Schema and table are excluded (they are orthogonal to policy equivalence).
 * Uses `JSON.stringify` for a deterministic encoding.
 */
export function computeContentHash(parts: ContentHashParts): string {
  const using = normalizePredicate(parts.using ?? '');
  const withCheck = normalizePredicate(parts.withCheck ?? '');
  const roles = [...new Set(parts.roles)].sort();
  const permissive = parts.permissive ? 'permissive' : 'restrictive';

  const tuple = JSON.stringify([using, withCheck, roles, parts.operation, permissive]);
  return createHash('sha256').update(tuple).digest('hex').slice(0, 8);
}
