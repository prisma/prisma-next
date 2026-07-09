import type { ContractToSchemaIROptions } from '@prisma-next/family-sql/control';
import { contractNamespaceToSchemaIR } from '@prisma-next/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { SqlForeignKeyIR } from '@prisma-next/sql-schema-ir/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type { PostgresRlsPolicy } from '../postgres-rls-policy';
import type { PostgresContract } from '../postgres-schema';
import { isPostgresSchema } from '../postgres-schema';
import { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../schema-ir/postgres-policy-schema-node';
import { PostgresRoleSchemaNode } from '../schema-ir/postgres-role-schema-node';
import { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import { resolveDdlSchemaForNamespaceStorage } from './resolve-ddl-schema';

function toPolicyNode(policy: PostgresRlsPolicy, namespaceId: string): PostgresPolicySchemaNode {
  return new PostgresPolicySchemaNode({
    name: policy.name,
    prefix: policy.prefix,
    tableName: policy.tableName,
    namespaceId,
    operation: policy.operation,
    roles: [...policy.roles],
    ...ifDefined('using', policy.using),
    ...ifDefined('withCheck', policy.withCheck),
    permissive: policy.permissive,
  });
}

/**
 * Projects a Postgres contract into the expected schema-diff tree: a
 * `PostgresDatabaseSchemaNode` root holding one `PostgresNamespaceSchemaNode`
 * per Postgres namespace, each holding its `PostgresTableSchemaNode`s with
 * their `PostgresPolicySchemaNode`s, plus the database roles on the root.
 *
 * Not a duplicate of the family's `contractToSchemaIR`: that builds a flat,
 * single `{ tables }` map (and throws on cross-namespace name collisions, with
 * no RLS/role concept) for SQLite's single-schema world. This is the
 * Postgres-specific *tree* shape — multi-schema, RLS-policy-aware, role-aware.
 * It reuses the family's per-namespace table conversion (`contractNamespaceToSchemaIR`)
 * for column/FK/index building and only adds the Postgres tree/policy/role shape.
 *
 * Tables are grouped by their owning namespace (resolved DDL schema name) so
 * the tree mirrors Postgres's object hierarchy. The DDL schema name is
 * resolved once per namespace.
 *
 * A policy that references a table absent from its namespace is a malformed
 * contract — the loop throws rather than fabricating a stub table.
 */
export function contractToPostgresDatabaseSchemaNode(
  contract: PostgresContract | null,
  options: ContractToSchemaIROptions,
): PostgresDatabaseSchemaNode {
  if (contract === null) {
    return new PostgresDatabaseSchemaNode({
      namespaces: {},
      roles: [],
      existingSchemas: [],
      pgVersion: '',
    });
  }

  const namespaces: Record<string, PostgresNamespaceSchemaNode> = {};
  const roles: PostgresRoleSchemaNode[] = [];
  const ownedSchemas: string[] = [];

  for (const ns of Object.values(contract.storage.namespaces)) {
    if (!isPostgresSchema(ns)) continue;
    const ddlSchema = resolveDdlSchemaForNamespaceStorage(contract.storage, ns.id);
    ownedSchemas.push(ddlSchema);

    // Convert only THIS namespace's tables (passing the full storage for
    // type/value-set/enum resolution that spans namespaces), so the same table
    // name can exist in two schemas without colliding in a bare-keyed record.
    const sqlTables = contractNamespaceToSchemaIR(contract.storage, ns.id, options).tables;

    const policiesByTable = new Map<string, PostgresPolicySchemaNode[]>();
    for (const policy of Object.values(ns.policy)) {
      const list = policiesByTable.get(policy.tableName) ?? [];
      list.push(toPolicyNode(policy, ddlSchema));
      policiesByTable.set(policy.tableName, list);
    }

    const tables: Record<string, PostgresTableSchemaNode> = {};
    for (const tableName of Object.keys(ns.table)) {
      const sqlTable = sqlTables[tableName];
      if (sqlTable === undefined) continue;
      // The family conversion stamps `referencedSchema` with the FK target's
      // namespace id verbatim, which can be the unbound sentinel. Resolve it
      // to the real live DDL schema here — introspected FKs already carry the
      // live schema, so this is what lets an expected FK pair (by diff-node
      // id) with its introspected counterpart.
      const foreignKeys = sqlTable.foreignKeys.map(
        (fk) =>
          new SqlForeignKeyIR({
            columns: fk.columns,
            referencedTable: fk.referencedTable,
            referencedColumns: fk.referencedColumns,
            ...ifDefined('referencedSchema', fk.referencedSchema),
            ...ifDefined('name', fk.name),
            ...ifDefined('onDelete', fk.onDelete),
            ...ifDefined('onUpdate', fk.onUpdate),
            ...ifDefined('annotations', fk.annotations),
            resolvedReferencedNamespace: resolveDdlSchemaForNamespaceStorage(
              contract.storage,
              fk.referencedSchema ?? UNBOUND_NAMESPACE_ID,
            ),
          }),
      );
      tables[tableName] = new PostgresTableSchemaNode({
        name: sqlTable.name,
        columns: sqlTable.columns,
        foreignKeys,
        uniques: sqlTable.uniques,
        indexes: sqlTable.indexes,
        ...ifDefined('primaryKey', sqlTable.primaryKey),
        ...ifDefined('annotations', sqlTable.annotations),
        ...ifDefined('checks', sqlTable.checks),
        policies: policiesByTable.get(tableName) ?? [],
      });
    }

    for (const [tableName, tablePolicies] of policiesByTable) {
      if (!(tableName in tables)) {
        const policyName = tablePolicies[0]?.name ?? '(unknown)';
        throw new Error(
          `contract-to-postgres-database-schema-node: policy "${policyName}" references table "${tableName}" not present in namespace "${ddlSchema}"`,
        );
      }
    }

    namespaces[ddlSchema] = new PostgresNamespaceSchemaNode({
      schemaName: ddlSchema,
      tables,
      nativeEnumTypeNames: [],
    });

    for (const role of Object.values(ns.role)) {
      roles.push(new PostgresRoleSchemaNode({ name: role.name, namespaceId: role.namespaceId }));
    }
  }

  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles,
    existingSchemas: ownedSchemas,
    pgVersion: '',
  });
}
