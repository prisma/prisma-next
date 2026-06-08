import type { ControlPolicy } from '@prisma-next/contract/types';
import type {
  SchemaIssue,
  VerifierIssueCategory,
  VerifierOutcome,
} from '@prisma-next/framework-components/control';
import { dispositionForCategory } from '@prisma-next/framework-components/control';

/**
 * Classifies the relational verifier issue kinds the SQL family emits (tables,
 * columns, constraints, indexes, defaults, enum types) into the target-neutral
 * categories the framework grades. The relational vocabulary lives here, in the
 * SQL domain — the framework never switches over `extra_foreign_key` and friends.
 */
export function classifySqlVerifierIssueKind(kind: SchemaIssue['kind']): VerifierIssueCategory {
  switch (kind) {
    case 'extra_column':
      return 'extraNestedElement';
    case 'extra_primary_key':
    case 'extra_foreign_key':
    case 'extra_unique_constraint':
    case 'extra_index':
    case 'extra_validator':
    case 'extra_default':
      return 'extraAuxiliary';
    case 'extra_table':
      return 'extraTopLevelObject';
    case 'missing_schema':
    case 'missing_table':
    case 'missing_column':
    case 'type_missing':
    case 'default_missing':
      return 'declaredMissing';
    case 'type_values_mismatch':
    case 'enum_values_changed':
    case 'check_mismatch':
      return 'valueDrift';
    case 'type_mismatch':
    case 'nullability_mismatch':
    case 'primary_key_mismatch':
    case 'foreign_key_mismatch':
    case 'unique_constraint_mismatch':
    case 'index_mismatch':
    case 'default_mismatch':
      return 'declaredIncompatible';
    case 'check_missing':
      return 'declaredMissing';
    case 'check_removed':
      return 'extraAuxiliary';
    // Provisional classifications for slice 4 to confirm when the verifier emits these kinds.
    case 'rls_policy_tampered':
      return 'valueDrift';
    case 'rls_policy_renamed':
    case 'rls_not_enabled':
      return 'declaredIncompatible';
  }
}

export function verifierDisposition(
  controlPolicy: ControlPolicy,
  issueKind: SchemaIssue['kind'],
): VerifierOutcome {
  return dispositionForCategory(controlPolicy, classifySqlVerifierIssueKind(issueKind));
}
