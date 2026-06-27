import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { PostgresRlsPolicy } from '../postgres-rls-policy';
import type { PostgresRole } from '../postgres-role';
import { isPostgresSchema } from '../postgres-schema';
import { resolveDdlSchemaForNamespaceStorage } from '../postgres-schema-ir-annotations';
import { groupPoliciesIntoTableNodes, type PostgresTableNode } from '../postgres-table-node';

/** Collect a contract's Postgres RLS policy nodes, with namespaceId resolved to the DDL schema name. */
export function collectContractRlsPolicies(
  contract: Contract<SqlStorage> | null,
): readonly PostgresRlsPolicy[] {
  if (contract === null) return [];
  return Object.values(contract.storage.namespaces).flatMap((ns) => {
    if (!isPostgresSchema(ns)) return [];
    return Object.values(ns.policy).map((policy) => {
      const resolvedSchema = resolveDdlSchemaForNamespaceStorage(
        contract.storage,
        policy.namespaceId,
      );
      if (resolvedSchema === policy.namespaceId) return policy;
      return new PostgresRlsPolicy({
        name: policy.name,
        prefix: policy.prefix,
        tableName: policy.tableName,
        namespaceId: resolvedSchema,
        operation: policy.operation,
        roles: [...policy.roles],
        ...(policy.using !== undefined ? { using: policy.using } : {}),
        ...(policy.withCheck !== undefined ? { withCheck: policy.withCheck } : {}),
        permissive: policy.permissive,
      });
    });
  });
}

/** Collect a contract's RLS policies grouped into table nodes. */
export function collectContractRlsTableNodes(
  contract: Contract<SqlStorage> | null,
): readonly PostgresTableNode[] {
  return groupPoliciesIntoTableNodes(collectContractRlsPolicies(contract));
}

/** Collect a contract's Postgres role nodes. */
export function collectContractRoles(
  contract: Contract<SqlStorage> | null,
): readonly PostgresRole[] {
  if (contract === null) return [];
  return Object.values(contract.storage.namespaces).flatMap((ns) =>
    isPostgresSchema(ns) ? Object.values(ns.role) : [],
  );
}
