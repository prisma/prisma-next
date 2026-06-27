import type { ContractToSchemaIROptions } from '@prisma-next/family-sql/control';
import { contractToSchemaIR } from '@prisma-next/family-sql/control';
import { ifDefined } from '@prisma-next/utils/defined';
import { PostgresRlsPolicy } from '../postgres-rls-policy';
import type { PostgresContract } from '../postgres-schema';
import { isPostgresSchema } from '../postgres-schema';
import { PostgresSchemaIR } from '../postgres-schema-ir';
import { resolveDdlSchemaForNamespaceStorage } from '../postgres-schema-ir-annotations';
import { PostgresTableIR } from '../postgres-table-ir';

/** The contract-to-postgres-schema-ir derivation: a populated PostgresSchemaIR. */
export function contractToPostgresSchemaIR(
  contract: PostgresContract | null,
  options: ContractToSchemaIROptions,
): PostgresSchemaIR {
  const sqlIr = contractToSchemaIR(contract, options);
  const ownedSchemas =
    contract === null
      ? []
      : Object.values(contract.storage.namespaces)
          .filter((ns) => isPostgresSchema(ns))
          .map((ns) => resolveDdlSchemaForNamespaceStorage(contract.storage, ns.id));

  // Build a map of tableName → PostgresRlsPolicy[], resolving the DDL schema
  // name once per namespace (not per policy).
  const policiesByTable = new Map<string, PostgresRlsPolicy[]>();
  if (contract !== null) {
    for (const ns of Object.values(contract.storage.namespaces)) {
      if (!isPostgresSchema(ns)) continue;
      const resolvedSchema = resolveDdlSchemaForNamespaceStorage(contract.storage, ns.id);
      for (const policy of Object.values(ns.policy)) {
        const resolved =
          resolvedSchema === policy.namespaceId
            ? policy
            : new PostgresRlsPolicy({
                name: policy.name,
                prefix: policy.prefix,
                tableName: policy.tableName,
                namespaceId: resolvedSchema,
                operation: policy.operation,
                roles: [...policy.roles],
                ...ifDefined('using', policy.using),
                ...ifDefined('withCheck', policy.withCheck),
                permissive: policy.permissive,
              });
        const list = policiesByTable.get(policy.tableName) ?? [];
        list.push(resolved);
        policiesByTable.set(policy.tableName, list);
      }
    }
  }

  // Attach policies to each table from the relational projection.
  // Also create stub entries for tables referenced only by policies (no SQL table body).
  const tables: Record<string, PostgresTableIR> = {};
  for (const [tableName, sqlTable] of Object.entries(sqlIr.tables)) {
    tables[tableName] = new PostgresTableIR({
      name: sqlTable.name,
      columns: sqlTable.columns,
      foreignKeys: sqlTable.foreignKeys,
      uniques: sqlTable.uniques,
      indexes: sqlTable.indexes,
      ...(sqlTable.primaryKey !== undefined ? { primaryKey: sqlTable.primaryKey } : {}),
      ...(sqlTable.annotations !== undefined ? { annotations: sqlTable.annotations } : {}),
      ...(sqlTable.checks !== undefined ? { checks: sqlTable.checks } : {}),
      rlsPolicies: policiesByTable.get(tableName) ?? [],
    });
  }
  for (const [tableName, policies] of policiesByTable) {
    if (!(tableName in tables)) {
      tables[tableName] = new PostgresTableIR({
        name: tableName,
        columns: {},
        foreignKeys: [],
        uniques: [],
        indexes: [],
        rlsPolicies: policies,
      });
    }
  }

  return new PostgresSchemaIR({
    tables,
    roles:
      contract === null
        ? []
        : Object.values(contract.storage.namespaces).flatMap((ns) =>
            isPostgresSchema(ns) ? Object.values(ns.role) : [],
          ),
    pgSchemaName: 'public',
    pgVersion: '',
    existingSchemas: ownedSchemas,
    nativeEnumTypeNames: [],
  });
}
