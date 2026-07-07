/**
 * SQL relational schema-diff exports.
 *
 * The shared relational diff that each SQL target descriptor's
 * `diffDatabaseSchema` composes (Postgres adds its structural policy diff on
 * top; SQLite is relational only). Pure — no database connection required.
 */

export type {
  SemanticSatisfactionInput,
  SemanticSatisfactionResult,
  SqlDiffVerdict,
  SqlDiffVerdictInput,
  StorageTypeVerdictInput,
} from '../core/diff/schema-diff-verify';
export {
  classifySqlDiffIssue,
  computeSqlDiffVerdict,
  computeStorageTypeVerdict,
  neutralizeFlatExpectedFkSchemas,
  normalizeFlatActualForDiff,
  resolveSemanticSatisfaction,
} from '../core/diff/schema-diff-verify';
export type {
  NativeTypeNormalizer,
  VerifySqlSchemaOptions,
} from '../core/diff/sql-schema-diff';
export { verifySqlSchema, verifySqlSchemaTree } from '../core/diff/sql-schema-diff';
export {
  arraysEqual,
  isIndexSatisfied,
  isUniqueConstraintSatisfied,
} from '../core/diff/verify-helpers';
