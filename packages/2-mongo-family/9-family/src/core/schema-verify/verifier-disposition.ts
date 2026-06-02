import type { ControlPolicy } from '@prisma-next/contract/types';
import type {
  SchemaIssue,
  VerifierIssueCategory,
  VerifierOutcome,
} from '@prisma-next/framework-components/control';
import { dispositionForCategory } from '@prisma-next/framework-components/control';

/**
 * Classifies the verifier issue kinds the Mongo schema differ emits into the
 * target-neutral categories the framework grades. Mongo only emits the kinds
 * listed below (missing/extra collections, missing/extra indexes, missing/extra
 * validators, and validator/options mismatches coded as `type_mismatch`); any
 * other kind never reaches this classifier and is graded conservatively as a
 * declared-incompatible divergence. Mongo owns this mapping rather than
 * importing the SQL classifier — the two families share only the framework's
 * category grading.
 */
export function classifyMongoVerifierIssueKind(kind: SchemaIssue['kind']): VerifierIssueCategory {
  switch (kind) {
    case 'extra_table':
      return 'extraTopLevelObject';
    case 'extra_index':
    case 'extra_validator':
      return 'extraAuxiliary';
    case 'missing_table':
    case 'type_missing':
      return 'declaredMissing';
    case 'index_mismatch':
    case 'type_mismatch':
      return 'declaredIncompatible';
    default:
      return 'declaredIncompatible';
  }
}

export function verifierDisposition(
  controlPolicy: ControlPolicy,
  issueKind: SchemaIssue['kind'],
): VerifierOutcome {
  return dispositionForCategory(controlPolicy, classifyMongoVerifierIssueKind(issueKind));
}
