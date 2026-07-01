import type { DiffableNode, SchemaDiffIssue } from '@prisma-next/framework-components/control';
import { diffSchemas } from '@prisma-next/framework-components/control';
import type { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { PostgresPolicySchemaNode } from '../schema-ir/postgres-policy-schema-node';

// Every node in a diff issue produced from Postgres schema trees is a
// `SqlSchemaIRNode`; the framework types it as the narrower `DiffableNode`.
function asSchemaNode(node: DiffableNode): SqlSchemaIRNode {
  return blindCast<
    SqlSchemaIRNode,
    'diff issues over Postgres schema trees carry SqlSchemaIRNode nodes'
  >(node);
}

// Renders a display-only reference string for the diff message. If policy
// rendering grows, route it through the adapter's SQL renderer so the message
// can't diverge from the emitted policy SQL.
function renderPostgresPolicyReference(policy: PostgresPolicySchemaNode): string {
  return `policy "${policy.name}" on "${policy.namespaceId}"."${policy.tableName}"`;
}

/**
 * Computes schema drift between two derived schema trees.
 *
 * 1. Runs the framework total diff over the two `PostgresDatabaseSchemaNode`
 *    roots (database → namespace → table → policy).
 * 2. Filters to policy-subject issues only — this is transitional: the generic
 *    differ walks the whole tree, but the legacy relational verifier still owns
 *    table/column drift, so non-policy issues are dropped here.
 * 3. Remaps the message to a human-readable policy reference.
 *
 * Ownership filtering (dropping `extra` issues in namespaces a contract doesn't
 * own) is the caller's responsibility — use `filterIssuesByOwnership`.
 */
export function diffPostgresSchema(
  expected: PostgresDatabaseSchemaNode,
  actual: PostgresDatabaseSchemaNode,
): readonly SchemaDiffIssue[] {
  const safeActual = PostgresDatabaseSchemaNode.ensure(actual);
  const issues = diffSchemas(expected, safeActual);

  return issues
    .filter((i) => {
      const node = i.expected ?? i.actual;
      return node !== undefined && PostgresPolicySchemaNode.is(asSchemaNode(node));
    })
    .map((i) => {
      const node = i.expected ?? i.actual;
      if (node === undefined) return i;
      const policy = asSchemaNode(node);
      if (!PostgresPolicySchemaNode.is(policy)) return i;
      return { ...i, message: `${i.outcome}: ${renderPostgresPolicyReference(policy)}` };
    });
}

/**
 * Filters `extra` policy issues to those in owned namespaces. Call after
 * `diffPostgresSchema` with the union of namespace ids from the expected tree's
 * policies and its `existingSchemas`.
 */
export function filterIssuesByOwnership(
  issues: readonly SchemaDiffIssue[],
  ownedSchemaNames: ReadonlySet<string>,
): readonly SchemaDiffIssue[] {
  return issues.filter((i) => {
    if (i.outcome !== 'extra') return true;
    if (i.actual === undefined) return false;
    const policy = asSchemaNode(i.actual);
    return PostgresPolicySchemaNode.is(policy) && ownedSchemaNames.has(policy.namespaceId);
  });
}
