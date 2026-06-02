import type { ControlPolicy } from '@prisma-next/contract/types';
import type { SchemaIssue, SchemaVerificationNode } from './control-result-types';

export type VerificationStatus = SchemaVerificationNode['status'];

export type VerifierOutcome = VerificationStatus | 'suppress';

export type VerifierIssueCategory =
  | 'declaredMissing'
  | 'declaredIncompatible'
  | 'typeValueDrift'
  | 'extraColumn'
  | 'extraConstraint'
  | 'extraTable';

export function classifyVerifierIssueKind(kind: SchemaIssue['kind']): VerifierIssueCategory {
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
    case 'type_values_mismatch':
    case 'enum_values_changed':
      return 'typeValueDrift';
    case 'type_mismatch':
    case 'nullability_mismatch':
    case 'primary_key_mismatch':
    case 'foreign_key_mismatch':
    case 'unique_constraint_mismatch':
    case 'index_mismatch':
    case 'default_mismatch':
      return 'declaredIncompatible';
  }
}

export function verifierDisposition(
  controlPolicy: ControlPolicy,
  issueKind: SchemaIssue['kind'],
): VerifierOutcome {
  if (controlPolicy === 'observed') {
    return 'warn';
  }
  const category = classifyVerifierIssueKind(issueKind);
  if (controlPolicy === 'tolerated' && category === 'extraColumn') {
    return 'suppress';
  }
  if (controlPolicy === 'external') {
    if (
      category === 'extraColumn' ||
      category === 'extraConstraint' ||
      category === 'extraTable' ||
      category === 'typeValueDrift'
    ) {
      return 'suppress';
    }
  }
  return 'fail';
}
