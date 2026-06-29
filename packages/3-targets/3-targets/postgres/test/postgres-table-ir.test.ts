import { describe, expect, it } from 'vitest';
import { PostgresRlsPolicy } from '../src/core/postgres-rls-policy';
import { isPostgresTableIR, PostgresTableIR } from '../src/core/schema-ir/postgres-table-ir';

const basePolicy = new PostgresRlsPolicy({
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

describe('PostgresTableIR', () => {
  it('id returns the table name', () => {
    const table = new PostgresTableIR({ ...tableInput, rlsPolicies: [] });
    expect(table.id).toBe('profiles');
  });

  it('id matches the name field', () => {
    const table = new PostgresTableIR({
      name: 'orders',
      columns: {},
      foreignKeys: [],
      uniques: [],
      indexes: [],
    });
    expect(table.id).toBe('orders');
  });

  it('isEqualTo always returns true', () => {
    const a = new PostgresTableIR({ ...tableInput, rlsPolicies: [basePolicy] });
    const b = new PostgresTableIR({ ...tableInput, rlsPolicies: [] });
    expect(a.isEqualTo(b)).toBe(true);
  });

  it('children() returns its rlsPolicies', () => {
    const table = new PostgresTableIR({ ...tableInput, rlsPolicies: [basePolicy] });
    expect(table.children()).toEqual([basePolicy]);
  });

  it('children() returns empty array when no policies', () => {
    const table = new PostgresTableIR({ ...tableInput, rlsPolicies: [] });
    expect(table.children()).toEqual([]);
  });

  it('rlsPolicies defaults to empty when not supplied', () => {
    const table = new PostgresTableIR({ ...tableInput });
    expect(table.rlsPolicies).toEqual([]);
  });

  it('carries columns from SqlTableIR', () => {
    const table = new PostgresTableIR({ ...tableInput });
    expect(Object.keys(table.columns)).toEqual(['id', 'user_id']);
    expect(table.columns['id']?.nativeType).toBe('int4');
  });

  it('instance is frozen', () => {
    const table = new PostgresTableIR({ ...tableInput });
    expect(Object.isFrozen(table)).toBe(true);
  });

  it('name field is set', () => {
    const table = new PostgresTableIR({ ...tableInput });
    expect(table.name).toBe('profiles');
  });

  describe('isPostgresTableIR guard', () => {
    it('returns true for a PostgresTableIR', () => {
      const table = new PostgresTableIR({ ...tableInput });
      expect(isPostgresTableIR(table)).toBe(true);
    });

    it('returns false for a PostgresRlsPolicy', () => {
      expect(isPostgresTableIR(basePolicy)).toBe(false);
    });
  });
});
