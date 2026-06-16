import type { Contract } from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
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
 * Policy identity is the wire name (dispatch brief: "identity uses name").
 * Namespace coordinates are not used for matching because the contract may use
 * UNBOUND_NAMESPACE_ID while the introspected schema carries the resolved DDL
 * schema name (e.g. 'public'). The table-name filter already scopes results to
 * tables present in the introspected schema IR.
 *
 * `strict` mirrors the family verifier's strict flag: `extra_rls_policy` issues
 * are only emitted when strict is true (widening or destructive ops allowed).
 * Callers using additive-only policy (e.g. `db init`) skip extra issues, matching
 * the family verifier's behavior for extra tables and columns.
 *
 * Scoping: only policies attached to tables present in the schema IR are
 * considered. Policies on tables outside the scope of the introspected IR
 * (e.g. another schema) are ignored.
 */
export function verifyPostgresRlsPolicies(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIR;
  readonly strict?: boolean;
}): readonly SchemaIssue[] {
  const { contract, schema, strict = false } = input;

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

  const expectedByName = new Map(expectedPolicies.map((p) => [p.name, p]));
  const actualByName = new Map(scopedActual.map((p) => [p.name, p]));

  const issues: SchemaIssue[] = [];

  for (const [name, policy] of expectedByName) {
    if (!actualByName.has(name)) {
      issues.push({
        kind: 'missing_rls_policy',
        namespaceId: policy.namespaceId,
        table: policy.tableName,
        indexOrConstraint: policy.name,
        message: `RLS policy "${policy.name}" on table "${policy.tableName}" is missing from the database`,
      });
    }
  }

  if (strict) {
    for (const [name, policy] of actualByName) {
      if (!expectedByName.has(name)) {
        issues.push({
          kind: 'extra_rls_policy',
          namespaceId: policy.namespaceId,
          table: policy.tableName,
          indexOrConstraint: policy.name,
          message: `RLS policy "${policy.name}" on table "${policy.tableName}" is present in the database but not in the contract`,
        });
      }
    }
  }

  return issues;
}
