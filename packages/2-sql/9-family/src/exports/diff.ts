/**
 * SQL relational schema-diff exports.
 *
 * The generic node differ (`buildPostgresPlanDiff` / `buildSqlitePlanDiff`)
 * drives both plan and verify; this module surfaces the shared
 * semantic-satisfaction predicates and verify-verdict machinery that survive
 * it. Pure — no database connection required.
 */

export type {
  SemanticSatisfactionInput,
  SemanticSatisfactionResult,
} from '../core/diff/diff-tree-normalization';
export {
  neutralizeFlatExpectedFkSchemas,
  normalizeFlatActualForDiff,
  resolveSemanticSatisfaction,
} from '../core/diff/diff-tree-normalization';
export type {
  SqlDiffVerdict,
  SqlDiffVerdictInput,
  StorageTypeVerdict,
  StorageTypeVerdictInput,
  VerifySqlSchemaByDiffInput,
} from '../core/diff/schema-verify';
export {
  classifySqlDiffIssue,
  computeSqlDiffVerdict,
  computeStorageTypeVerdict,
  stampSubjectGranularity,
  verifySqlSchemaByDiff,
} from '../core/diff/schema-verify';
export type { NativeTypeNormalizer } from '../core/diff/sql-schema-diff';
export {
  arraysEqual,
  isIndexSatisfied,
  isUniqueConstraintSatisfied,
} from '../core/diff/sql-schema-diff';
