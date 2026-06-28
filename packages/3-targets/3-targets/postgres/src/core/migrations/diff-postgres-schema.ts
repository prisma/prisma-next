import type { SchemaDiffIssue } from '@prisma-next/framework-components/control';
import { diffSchemas } from '@prisma-next/framework-components/control';
import { isPostgresRlsPolicy, type PostgresRlsPolicy } from '../schema-ir/postgres-rls-policy';
import { ensurePostgresSchemaIR, type PostgresSchemaIR } from '../schema-ir/postgres-schema-ir';

function renderPostgresPolicyReference(policy: PostgresRlsPolicy): string {
  return `policy "${policy.name}" on "${policy.namespaceId}"."${policy.tableName}"`;
}

/**
 * Computes RLS policy drift between two derived schema IRs.
 *
 * 1. Runs the framework total diff.
 * 2. Whitelists to policy-subject issues (drops table-node and root-node issues).
 * 3. Remaps the message to a human-readable policy reference.
 *
 * Ownership filtering (dropping `extra` issues in namespaces a contract doesn't
 * own) is the caller's responsibility — use `filterIssuesByOwnership`.
 */
export function diffPostgresSchema(
  expected: PostgresSchemaIR,
  actual: PostgresSchemaIR,
): readonly SchemaDiffIssue[] {
  const safeActual = ensurePostgresSchemaIR(actual);
  const issues = diffSchemas(expected, safeActual);

  return issues
    .filter((i) => isPostgresRlsPolicy(i.expected ?? i.actual))
    .map((i) => {
      const policy = i.expected ?? i.actual;
      if (!isPostgresRlsPolicy(policy)) return i;
      return { ...i, message: `${i.outcome}: ${renderPostgresPolicyReference(policy)}` };
    });
}

/**
 * Filters `extra` policy issues to those in owned namespaces. Call after
 * `diffPostgresSchema` with the union of namespace ids from the expected IR's
 * policies and its `existingSchemas`.
 */
export function filterIssuesByOwnership(
  issues: readonly SchemaDiffIssue[],
  ownedSchemaNames: ReadonlySet<string>,
): readonly SchemaDiffIssue[] {
  return issues.filter(
    (i) =>
      i.outcome !== 'extra' ||
      (isPostgresRlsPolicy(i.actual) && ownedSchemaNames.has(i.actual.namespaceId)),
  );
}
