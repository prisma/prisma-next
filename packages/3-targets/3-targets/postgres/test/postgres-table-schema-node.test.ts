import { describe, expect, it } from 'vitest';
import { PostgresPolicySchemaNode } from '../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../src/core/schema-ir/postgres-table-schema-node';

const basePolicy = new PostgresPolicySchemaNode({
  name: 'read_own_a1b2c3d4',
  prefix: 'read_own',
  tableName: 'profiles',
  namespaceId: 'public',
  operation: 'select' as const,
  roles: ['authenticated'],
  using: '(auth.uid() = user_id)',
  permissive: true,
});

const tableInput = {
  name: 'profiles',
  columns: {
    id: { name: 'id', nativeType: 'int4', nullable: false },
    user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
  },
  foreignKeys: [],
  uniques: [],
  indexes: [],
};

describe('PostgresTableSchemaNode', () => {
  it('id returns the table name', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput, policies: [] });
    expect(table.id).toBe('profiles');
  });

  it('id matches the name field', () => {
    const table = new PostgresTableSchemaNode({
      name: 'orders',
      columns: {},
      foreignKeys: [],
      uniques: [],
      indexes: [],
    });
    expect(table.id).toBe('orders');
  });

  it('isEqualTo matches by id (name), ignoring columns and policies', () => {
    const a = new PostgresTableSchemaNode({ ...tableInput, policies: [basePolicy] });
    const same = new PostgresTableSchemaNode({ ...tableInput, policies: [] });
    const other = new PostgresTableSchemaNode({ ...tableInput, name: 'other', policies: [] });
    expect(a.isEqualTo(same)).toBe(true);
    expect(a.isEqualTo(other)).toBe(false);
  });

  it('children() returns its policies', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput, policies: [basePolicy] });
    expect(table.children()).toEqual([basePolicy]);
  });

  it('children() returns empty array when no policies', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput, policies: [] });
    expect(table.children()).toEqual([]);
  });

  it('policies defaults to empty when not supplied', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput });
    expect(table.policies).toEqual([]);
  });

  it('carries columns from SqlTableIR', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput });
    expect(Object.keys(table.columns)).toEqual(['id', 'user_id']);
    expect(table.columns['id']?.nativeType).toBe('int4');
  });

  it('instance is frozen', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput });
    expect(Object.isFrozen(table)).toBe(true);
  });

  it('name field is set', () => {
    const table = new PostgresTableSchemaNode({ ...tableInput });
    expect(table.name).toBe('profiles');
  });

  describe('PostgresTableSchemaNode.is guard', () => {
    it('returns true for a PostgresTableSchemaNode', () => {
      const table = new PostgresTableSchemaNode({ ...tableInput });
      expect(PostgresTableSchemaNode.is(table)).toBe(true);
    });

    it('returns false for a PostgresPolicySchemaNode', () => {
      expect(PostgresTableSchemaNode.is(basePolicy)).toBe(false);
    });
  });
});
