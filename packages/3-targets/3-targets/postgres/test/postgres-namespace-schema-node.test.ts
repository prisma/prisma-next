import type { SqlSchemaIR, SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';
import { describe, expect, expectTypeOf, it, test } from 'vitest';
import { PostgresNamespaceSchemaNode } from '../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresRoleSchemaNode } from '../src/core/schema-ir/postgres-role-schema-node';
import { PostgresTableSchemaNode } from '../src/core/schema-ir/postgres-table-schema-node';

const policy = new PostgresPolicySchemaNode({
  name: 'read_own_a1b2c3d4',
  prefix: 'read_own',
  tableName: 'profiles',
  namespaceId: 'public',
  operation: 'select' as const,
  roles: ['authenticated'],
  using: '(auth.uid() = user_id)',
  permissive: true,
});

const tableA = new PostgresTableSchemaNode({
  name: 'profiles',
  columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
  foreignKeys: [],
  uniques: [],
  indexes: [],
  policies: [policy],
});

const tableB = new PostgresTableSchemaNode({
  name: 'orders',
  columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
  foreignKeys: [],
  uniques: [],
  indexes: [],
  policies: [],
});

const baseInput = {
  schemaName: 'public',
  tables: { profiles: tableA, orders: tableB },
  nativeEnumTypeNames: ['status_enum'],
};

describe('PostgresNamespaceSchemaNode', () => {
  it('id returns schemaName', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(node.id).toBe('public');
  });

  it('isEqualTo matches by id (schema name)', () => {
    const a = new PostgresNamespaceSchemaNode(baseInput);
    const same = new PostgresNamespaceSchemaNode({ ...baseInput, nativeEnumTypeNames: [] });
    const other = new PostgresNamespaceSchemaNode({ ...baseInput, schemaName: 'other' });
    expect(a.isEqualTo(same)).toBe(true);
    expect(a.isEqualTo(other)).toBe(false);
  });

  it('children() returns table nodes', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(node.children()).toEqual([tableA, tableB]);
  });

  it('children() returns empty array when no tables', () => {
    const node = new PostgresNamespaceSchemaNode({
      schemaName: 'empty',
      tables: {},
      nativeEnumTypeNames: [],
    });
    expect(node.children()).toEqual([]);
  });

  it('children() does not include roles (roles are database-level)', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    const children = node.children();
    for (const child of children) {
      expect(PostgresRoleSchemaNode.is(child as SqlSchemaIRNode)).toBe(false);
    }
  });

  it('carries schemaName', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(node.schemaName).toBe('public');
  });

  it('carries nativeEnumTypeNames', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(node.nativeEnumTypeNames).toEqual(['status_enum']);
  });

  it('carries tables keyed by name', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(Object.keys(node.tables)).toEqual(['profiles', 'orders']);
    expect(node.tables['profiles']).toBe(tableA);
  });

  it('annotations.pg carries schema and nativeEnumTypeNames', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    const pg = node.annotations?.['pg'] as Record<string, unknown> | undefined;
    expect(pg?.['schema']).toBe('public');
    expect(pg?.['nativeEnumTypeNames']).toEqual(['status_enum']);
  });

  it('annotations.pg omits nativeEnumTypeNames when empty', () => {
    const node = new PostgresNamespaceSchemaNode({
      ...baseInput,
      nativeEnumTypeNames: [],
    });
    const pg = node.annotations?.['pg'] as Record<string, unknown> | undefined;
    expect(pg?.['nativeEnumTypeNames']).toBeUndefined();
  });

  it('annotations.pg does not carry existingSchemas (database-level field)', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    const pg = node.annotations?.['pg'] as Record<string, unknown> | undefined;
    expect(pg?.['existingSchemas']).toBeUndefined();
  });

  it('instance is frozen', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(Object.isFrozen(node)).toBe(true);
  });

  describe('PostgresNamespaceSchemaNode.is', () => {
    it('returns true for a PostgresNamespaceSchemaNode', () => {
      const node = new PostgresNamespaceSchemaNode(baseInput);
      expect(PostgresNamespaceSchemaNode.is(node)).toBe(true);
    });

    it('returns false for a PostgresTableSchemaNode', () => {
      expect(PostgresNamespaceSchemaNode.is(tableA)).toBe(false);
    });

    it('returns false for a PostgresPolicySchemaNode', () => {
      expect(PostgresNamespaceSchemaNode.is(policy)).toBe(false);
    });
  });
});

test('PostgresNamespaceSchemaNode is assignable to SqlSchemaIR', () => {
  const node = new PostgresNamespaceSchemaNode(baseInput);
  expectTypeOf(node).toExtend<SqlSchemaIR>();
});
