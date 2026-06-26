import type { SchemaDiffIssue } from '@prisma-next/framework-components/control';
import { diffSchemas } from '@prisma-next/framework-components/control';
import { isPostgresRlsPolicy } from '../postgres-rls-policy';
import { ensurePostgresSchemaIR, type PostgresSchemaIR } from '../postgres-schema-ir';

/**
 * Computes RLS policy drift between two derived schema IRs.
 *
 * 1. Runs the framework total diff.
 * 2. Whitelists to policy-subject issues (drops table-node and root-node issues).
 * 3. Drops `extra` issues whose policy's namespace is not owned by `expected`.
 *
 * Both IRs must have namespaceId already resolved to DDL schema names (done at
 * derivation time by `collectContractRlsPolicies`). Ownership is derived from
 * `expected`: the union of namespace ids in its policies and in its
 * `existingSchemas` (populated by `contractToPostgresSchemaIR` from the contract's
 * declared namespaces).
 */
export function diffPostgresSchema(
  expected: PostgresSchemaIR,
  actual: PostgresSchemaIR,
): readonly SchemaDiffIssue[] {
  const safeActual = ensurePostgresSchemaIR(actual);
  const issues = diffSchemas(expected, safeActual);

  const policyIssues = issues.filter((i) => isPostgresRlsPolicy(i.expected ?? i.actual));

  const owned = new Set([
    ...expected.rlsPolicies.map((p) => p.namespaceId),
    ...expected.existingSchemas,
  ]);

  return policyIssues.filter(
    (i) =>
      i.outcome !== 'extra' || (isPostgresRlsPolicy(i.actual) && owned.has(i.actual.namespaceId)),
  );
}
