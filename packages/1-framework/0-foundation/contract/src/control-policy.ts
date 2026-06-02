/**
 * Governance posture for a storage-plane node or for the contract as a whole.
 *
 * - `managed`  — Prisma Next owns the full lifecycle (DDL, migrations, verification).
 * - `tolerated` — node was found in the database but is not schema-managed; Prisma Next
 *   leaves it untouched while tracking its existence.
 * - `external` — node is owned by an external system; Prisma Next never emits DDL for it.
 * - `observed` — read-only access; Prisma Next does not write to or migrate the node.
 */
export type ControlPolicy = 'managed' | 'tolerated' | 'external' | 'observed';

/**
 * Resolves the effective control policy for a storage-plane node.
 *
 * Precedence: node-level value → contract default → `'managed'`.
 *
 * Both parameters are optional raw values so this function stays node-type-agnostic
 * and can be called by any consumer (verifier, planner, etc.) without importing IR classes.
 */
export function effectiveControlPolicy(
  nodeControl: ControlPolicy | undefined,
  defaultControl: ControlPolicy | undefined,
): ControlPolicy {
  return nodeControl ?? defaultControl ?? 'managed';
}

export type VerifierIssueCategory =
  | 'declaredMissing'
  | 'declaredIncompatible'
  | 'typeValueDrift'
  | 'extraColumn'
  | 'extraConstraint'
  | 'extraTable';

export type VerifierDisposition = 'fail' | 'warn' | 'suppress';

export function classifyVerifierIssueKind(kind: string): VerifierIssueCategory {
  switch (kind) {
    case 'extra_column':
      return 'extraColumn';
    case 'extra_primary_key':
    case 'extra_foreign_key':
    case 'extra_unique_constraint':
    case 'extra_index':
    case 'extra_validator':
    case 'extra_default':
      return 'extraConstraint';
    case 'extra_table':
      return 'extraTable';
    case 'missing_schema':
    case 'missing_table':
    case 'missing_column':
    case 'type_missing':
    case 'default_missing':
      return 'declaredMissing';
    // The value set of an existing type (e.g. a Postgres enum). An `external`
    // owner controls these values, so the framework relinquishes the internal
    // value set the same way it ignores extra constraints — existence is still
    // required (`type_missing` stays `declaredMissing`), but value drift on an
    // external type is not the framework's to police.
    case 'type_values_mismatch':
    case 'enum_values_changed':
      return 'typeValueDrift';
    default:
      return 'declaredIncompatible';
  }
}

export function verifierDisposition(
  control: ControlPolicy,
  issueKind: string,
): VerifierDisposition {
  if (control === 'observed') {
    return 'warn';
  }
  const category = classifyVerifierIssueKind(issueKind);
  if (control === 'tolerated' && category === 'extraColumn') {
    return 'suppress';
  }
  if (control === 'external') {
    if (
      category === 'extraColumn' ||
      category === 'extraConstraint' ||
      category === 'typeValueDrift'
    ) {
      return 'suppress';
    }
  }
  return 'fail';
}
