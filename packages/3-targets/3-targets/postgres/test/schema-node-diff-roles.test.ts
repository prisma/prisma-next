import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { PostgresDatabaseSchemaNode } from '../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresRoleSchemaNode } from '../src/core/schema-ir/postgres-role-schema-node';
import { PostgresTableSchemaNode } from '../src/core/schema-ir/postgres-table-schema-node';

/**
 * `diffRole` is the declared verdict-classification discriminant the family's
 * post-diff filters key on. Namespace/table nodes carry the roles their extras
 * classify under (extraTopLevelObject, strict-gated); policy and role nodes are
 * `structural` — the structural diff was never strict-gated, so its extras fail
 * in both modes. The role is a prototype getter: absent from spreads and JSON.
 */
describe('Postgres schema-node diffRole', () => {
  it.each([
    [
      'PostgresDatabaseSchemaNode',
      new PostgresDatabaseSchemaNode({
        namespaces: {},
        roles: [],
        existingSchemas: [],
        pgVersion: '',
      }),
      'structural',
    ],
    [
      'PostgresNamespaceSchemaNode',
      new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {},
        nativeEnumTypeNames: [],
      }),
      'namespace',
    ],
    [
      'PostgresTableSchemaNode',
      new PostgresTableSchemaNode({
        name: 't',
        columns: {},
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: [],
      }),
      'table',
    ],
    [
      'PostgresPolicySchemaNode',
      new PostgresPolicySchemaNode({
        name: 'read_own_a1b2c3d4',
        prefix: 'read_own',
        tableName: 'profiles',
        namespaceId: 'public',
        operation: 'select',
        roles: ['authenticated'],
        permissive: true,
      }),
      'structural',
    ],
    [
      'PostgresRoleSchemaNode',
      new PostgresRoleSchemaNode({ name: 'authenticated', namespaceId: UNBOUND_NAMESPACE_ID }),
      'structural',
    ],
  ] as const)('%s declares diffRole %s, non-enumerable', (_label, node, expectedRole) => {
    expect(node.diffRole).toBe(expectedRole);
    expect(Object.keys(node)).not.toContain('diffRole');
    expect(JSON.parse(JSON.stringify(node))).not.toHaveProperty('diffRole');
  });
});
