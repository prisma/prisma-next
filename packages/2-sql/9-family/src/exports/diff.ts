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
export type {
  CollectSqlSchemaIssuesOptions,
  NativeTypeNormalizer,
} from '../core/diff/sql-schema-diff';
export {
  arraysEqual,
  collectSqlSchemaIssues,
  collectSqlSchemaIssuesPerNamespace,
  isIndexSatisfied,
  isUniqueConstraintSatisfied,
} from '../core/diff/sql-schema-diff';
