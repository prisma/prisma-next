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
  SqlDiffVerdict,
  SqlDiffVerdictInput,
  StorageTypeVerdict,
  StorageTypeVerdictInput,
  VerifySqlSchemaByDiffInput,
} from '../core/diff/schema-diff-verify';
export {
  classifySqlDiffIssue,
  computeSqlDiffVerdict,
  computeStorageTypeVerdict,
  neutralizeFlatExpectedFkSchemas,
  normalizeFlatActualForDiff,
  resolveSemanticSatisfaction,
  verifySqlSchemaByDiff,
} from '../core/diff/schema-diff-verify';
export type { NativeTypeNormalizer } from '../core/diff/sql-schema-diff';
export {
  arraysEqual,
  isIndexSatisfied,
  isUniqueConstraintSatisfied,
} from '../core/diff/sql-schema-diff';
