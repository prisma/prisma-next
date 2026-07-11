import { describe, expect, it } from 'vitest';
import { PostgresNamespaceSchemaNode } from '../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresNativeEnumSchemaNode } from '../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresPolicySchemaNode } from '../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresRoleSchemaNode } from '../src/core/schema-ir/postgres-role-schema-node';
import { PostgresTableSchemaNode } from '../src/core/schema-ir/postgres-table-schema-node';
import type { SqlSchemaDiffNode } from '../src/core/schema-ir/schema-node-kinds';

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
  rlsEnabled: false,
});

const tableB = new PostgresTableSchemaNode({
  name: 'orders',
  columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
  foreignKeys: [],
  uniques: [],
  indexes: [],
  policies: [],
  rlsEnabled: false,
});

const baseInput = {
  schemaName: 'public',
  tables: { profiles: tableA, orders: tableB },
};

describe('PostgresNamespaceSchemaNode', () => {
  it('id returns schemaName', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(node.id).toBe('public');
  });

  it('isEqualTo matches by id (schema name)', () => {
    const a = new PostgresNamespaceSchemaNode(baseInput);
    const same = new PostgresNamespaceSchemaNode(baseInput);
    const other = new PostgresNamespaceSchemaNode({ ...baseInput, schemaName: 'other' });
    expect(a.isEqualTo(same)).toBe(true);
    expect(a.isEqualTo(other)).toBe(false);
  });

  it('children() returns table nodes', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(node.children()).toEqual([tableA, tableB]);
  });

  it('children() returns empty array when no tables', () => {
    const node = new PostgresNamespaceSchemaNode({ schemaName: 'empty', tables: {} });
    expect(node.children()).toEqual([]);
  });

  it('children() does not include roles (roles are database-level)', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    for (const child of node.children()) {
      expect(PostgresRoleSchemaNode.is(child as SqlSchemaDiffNode)).toBe(false);
    }
  });

  it('carries schemaName', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(node.schemaName).toBe('public');
  });

  it('carries tables keyed by name', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(Object.keys(node.tables)).toEqual(['profiles', 'orders']);
    expect(node.tables['profiles']).toBe(tableA);
  });

  it('instance is frozen', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(Object.isFrozen(node)).toBe(true);
  });

  describe('native enums', () => {
    it('actual side: derives enum nodes + plain views from the introspection carrier', () => {
      const node = new PostgresNamespaceSchemaNode({
        ...baseInput,
        nativeEnums: [{ typeName: 'status_enum', values: ['draft', 'review', 'done'] }],
      });
      expect(node.nativeEnums).toEqual([
        { typeName: 'status_enum', values: ['draft', 'review', 'done'] },
      ]);
      expect(node.nativeEnumTypeNames).toEqual(['status_enum']);
      expect(node.enums).toEqual([
        expect.objectContaining({ typeName: 'status_enum', members: ['draft', 'review', 'done'] }),
      ]);
    });

    it('expected side: accepts enum nodes directly into children (no plain carrier needed)', () => {
      const enumNode = new PostgresNativeEnumSchemaNode({
        typeName: 'aal_level',
        namespaceId: 'auth',
        members: ['aal1', 'aal2'],
        control: 'external',
      });
      const node = new PostgresNamespaceSchemaNode({
        schemaName: 'auth',
        tables: {},
        enums: [enumNode],
      });
      expect(node.enums).toEqual([enumNode]);
      expect(node.children()).toEqual([enumNode]);
      // The plain carrier is actual-only and stays empty when the expected side
      // passes nodes directly.
      expect(node.nativeEnums).toEqual([]);
    });

    it('defaults nativeEnumTypeNames to the nativeEnums type names when omitted', () => {
      const node = new PostgresNamespaceSchemaNode({
        ...baseInput,
        nativeEnums: [{ typeName: 'a_enum', values: ['x'] }],
      });
      expect(node.nativeEnumTypeNames).toEqual(['a_enum']);
    });

    it('keeps an explicit nativeEnumTypeNames independent of nativeEnums', () => {
      const node = new PostgresNamespaceSchemaNode({
        ...baseInput,
        nativeEnumTypeNames: ['ghost_enum'],
      });
      expect(node.nativeEnumTypeNames).toEqual(['ghost_enum']);
      expect(node.nativeEnums).toEqual([]);
    });

    it('defaults to empty when neither enums nor nativeEnums is supplied', () => {
      const node = new PostgresNamespaceSchemaNode(baseInput);
      expect(node.enums).toEqual([]);
      expect(node.nativeEnums).toEqual([]);
      expect(node.nativeEnumTypeNames).toEqual([]);
    });

    it('freezes the derived nativeEnums views', () => {
      const node = new PostgresNamespaceSchemaNode({
        ...baseInput,
        nativeEnums: [{ typeName: 'status_enum', values: ['draft', 'review'] }],
      });
      expect(Object.isFrozen(node.nativeEnums)).toBe(true);
      expect(Object.isFrozen(node.nativeEnums[0])).toBe(true);
      expect(Object.isFrozen(node.nativeEnums[0]?.values)).toBe(true);
    });

    it('exposes one enum diff node per entry through children()', () => {
      const node = new PostgresNamespaceSchemaNode({
        schemaName: 'auth',
        tables: { profiles: tableA },
        nativeEnums: [{ typeName: 'aal_level', values: ['aal1', 'aal2'] }],
      });
      const enumChildren = node.children().filter((child) => child.id.startsWith('native_enum:'));
      expect(enumChildren).toEqual([
        expect.objectContaining({
          nodeKind: 'postgres-native-enum',
          typeName: 'aal_level',
          namespaceId: 'auth',
          members: ['aal1', 'aal2'],
        }),
      ]);
      expect(node.children()).toHaveLength(2);
    });

    it('threads an entry-level control grade onto the derived node', () => {
      const node = new PostgresNamespaceSchemaNode({
        schemaName: 'auth',
        tables: {},
        nativeEnums: [{ typeName: 'aal_level', values: ['aal1'], control: 'external' }],
      });
      expect(node.children()[0]).toMatchObject({ control: 'external' });
    });

    it('children() stays tables-only when no enums are supplied (regression pin)', () => {
      const node = new PostgresNamespaceSchemaNode(baseInput);
      expect(node.children()).toEqual([tableA, tableB]);
    });
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

  it('carries a `tables` field readable by legacy per-schema consumers reading SqlSchemaIRNode structurally', () => {
    const node = new PostgresNamespaceSchemaNode(baseInput);
    expect(Object.keys(node.tables)).toEqual(['profiles', 'orders']);
  });
});
