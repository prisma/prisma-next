import type {
  SchemaIssue,
  SchemaVerifier,
  SchemaVerifyOptions,
  SchemaVerifyResult,
} from '@prisma-next/framework-components/control';

/**
 * SQL family `SchemaVerifier` abstract base. Centralises the SQL-shared
 * walk (table-by-table + column-by-column matching keyed by
 * `(namespace.id, name)`, FK / unique / index comparisons via the
 * existing helpers in `verify-helpers.ts`) and exposes a protected hook
 * for target extensions (Postgres functions, RLS policies, future
 * target-only kinds).
 *
 * The base accumulates issues in a single buffer and returns the
 * combined result; the per-SPI family abstract handles the result
 * envelope shape so concrete subclasses focus on target-specific
 * verification logic.
 *
 * M1 ships only the shell. The SQL-shared walk lands in M3 alongside
 * Postgres + SQLite IR-class concretions; the protected hooks are
 * declared here so target subclasses (`PostgresSchemaVerifier`,
 * `SqliteSchemaVerifier`) compile against a stable base API.
 */
export abstract class SqlSchemaVerifierBase<TContract, TSchema>
  implements SchemaVerifier<TContract, TSchema>
{
  verifySchema(options: SchemaVerifyOptions<TContract, TSchema>): SchemaVerifyResult {
    const issues: SchemaIssue[] = [];
    issues.push(...this.verifyCommonSqlSchema(options));
    issues.push(...this.verifyTargetExtensions(options));
    return { ok: issues.length === 0, issues };
  }

  /**
   * SQL-shared verification — table/column/FK/unique/index walks keyed by
   * `(namespace.id, name)`. M1 ships the abstract hook; the M3 commit
   * provides the family-shared implementation in subclasses (or, more
   * likely, lifts a shared helper into this base).
   */
  protected abstract verifyCommonSqlSchema(
    options: SchemaVerifyOptions<TContract, TSchema>,
  ): readonly SchemaIssue[];

  /**
   * Target-specific extensions — e.g. Postgres functions, future RLS
   * policies, namespace-mismatch issues. Returns the empty list when the
   * target ships no extensions over the SQL family alphabet.
   */
  protected abstract verifyTargetExtensions(
    options: SchemaVerifyOptions<TContract, TSchema>,
  ): readonly SchemaIssue[];
}
