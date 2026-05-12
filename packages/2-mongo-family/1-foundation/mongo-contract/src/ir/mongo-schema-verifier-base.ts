import type {
  SchemaIssue,
  SchemaVerifier,
  SchemaVerifyOptions,
  SchemaVerifyResult,
} from '@prisma-next/framework-components/control';

/**
 * Mongo family `SchemaVerifier` abstract base. Centralises the Mongo-
 * shared walk (collection-by-collection matching keyed by
 * `(namespace.id, name)`, validator / index comparisons) and exposes a
 * protected hook for target extensions (Atlas-specific kinds, future
 * Mongo-target-only kinds).
 *
 * The base accumulates issues in a single buffer and returns the
 * combined result; the family abstract handles the result envelope so
 * concrete subclasses focus on target-specific verification logic.
 *
 * M1 ships only the shell. The Mongo-shared walk lands in M2 alongside
 * Mongo's concrete contract IR class flip; the protected hooks are
 * declared here so `MongoTargetSchemaVerifier` compiles against a
 * stable base API.
 */
export abstract class MongoSchemaVerifierBase<TContract, TSchema>
  implements SchemaVerifier<TContract, TSchema>
{
  verifySchema(options: SchemaVerifyOptions<TContract, TSchema>): SchemaVerifyResult {
    const issues: SchemaIssue[] = [];
    issues.push(...this.verifyCommonMongoSchema(options));
    issues.push(...this.verifyTargetExtensions(options));
    return { ok: issues.length === 0, issues };
  }

  /**
   * Mongo-shared verification — collection/validator/index walks keyed by
   * `(namespace.id, name)`. M1 ships the abstract hook; the M2 commit
   * provides the family-shared implementation.
   */
  protected abstract verifyCommonMongoSchema(
    options: SchemaVerifyOptions<TContract, TSchema>,
  ): readonly SchemaIssue[];

  /**
   * Target-specific extensions — e.g. Atlas-only kinds, future
   * namespace-mismatch issues. Returns the empty list when the target
   * ships no extensions over the Mongo family alphabet.
   */
  protected abstract verifyTargetExtensions(
    options: SchemaVerifyOptions<TContract, TSchema>,
  ): readonly SchemaIssue[];
}
