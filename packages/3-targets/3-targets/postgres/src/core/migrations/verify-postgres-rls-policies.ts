import type { Contract } from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import { diffNodes } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import type { PostgresRlsPolicy } from '../postgres-rls-policy';
import { isPostgresSchema } from '../postgres-schema';
import { readPostgresSchemaIrAnnotations } from '../postgres-schema-ir-annotations';

function rlsPoliciesFromAnnotations(schema: SqlSchemaIR): readonly PostgresRlsPolicy[] {
  const { rlsPolicies } = readPostgresSchemaIrAnnotations(schema);
  return rlsPolicies ?? [];
}

/**
 * Emits `missing_rls_policy` / `extra_rls_policy` issues for every contract
 * namespace that declares RLS policies. Follows the same pattern as
 * `verifyPostgresNamespacePresence` — runs at the target layer, stitched into
 * `collectSchemaIssues` so a single `SchemaIssue[]` flows through `planIssues`.
 *
 * Scoping: only policies attached to tables present in the schema IR are
 * considered. Policies on tables outside the scope of the introspected IR
 * (e.g. another schema) are ignored.
 */
export function verifyPostgresRlsPolicies(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIR;
}): readonly SchemaIssue[] {
  const { contract, schema } = input;

  const expectedPolicies: PostgresRlsPolicy[] = [];
  for (const ns of Object.values(contract.storage.namespaces)) {
    if (isPostgresSchema(ns)) {
      for (const policy of Object.values(ns.policy)) {
        expectedPolicies.push(policy);
      }
    }
  }

  const actualPolicies = rlsPoliciesFromAnnotations(schema);
  const schemaTableNames = new Set(Object.keys(schema.tables));
  const scopedActual = actualPolicies.filter((p) => schemaTableNames.has(p.tableName));

  const diffs = diffNodes(expectedPolicies, scopedActual);
  const issues: SchemaIssue[] = [];

  for (const diff of diffs) {
    if (diff.outcome === 'missing') {
      const policy = expectedPolicies.find((p) => p.name === diff.coordinate.entityName);
      if (!policy) continue;
      issues.push({
        kind: 'missing_rls_policy',
        namespaceId: policy.namespaceId,
        table: policy.tableName,
        message: `RLS policy "${policy.name}" on table "${policy.tableName}" is missing from the database`,
      });
    } else if (diff.outcome === 'extra') {
      const policy = scopedActual.find((p) => p.name === diff.coordinate.entityName);
      if (!policy) continue;
      issues.push({
        kind: 'extra_rls_policy',
        namespaceId: policy.namespaceId,
        table: policy.tableName,
        message: `RLS policy "${policy.name}" on table "${policy.tableName}" is present in the database but not in the contract`,
      });
    }
  }

  return issues;
}
