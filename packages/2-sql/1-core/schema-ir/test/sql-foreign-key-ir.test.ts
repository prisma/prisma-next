import { describe, expect, it } from 'vitest';

import { SqlForeignKeyIR } from '../src/ir/sql-foreign-key-ir';

describe('SqlForeignKeyIR', () => {
  it('id is derived from the column tuple and referenced coordinates, not name', () => {
    const fk = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
      referencedSchema: 'public',
      name: 'fk_orders_user_id',
    });
    expect(fk.id).toBe('foreign-key:user_id->public.users(id)');
  });

  it('two unnamed FKs with the same coordinates share the same id', () => {
    const a = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
    });
    const b = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
    });
    expect(a.id).toBe(b.id);
  });

  it('two FKs on the same table referencing different tables get distinct ids', () => {
    const a = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
    });
    const b = new SqlForeignKeyIR({
      columns: ['org_id'],
      referencedTable: 'organizations',
      referencedColumns: ['id'],
    });
    expect(a.id).not.toBe(b.id);
  });

  it('nodeKind is the foreign-key kind', () => {
    const fk = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
    });
    expect(fk.nodeKind).toBe('sql-foreign-key');
  });

  it('children is empty (a foreign key is a leaf)', () => {
    const fk = new SqlForeignKeyIR({
      columns: ['user_id'],
      referencedTable: 'users',
      referencedColumns: ['id'],
    });
    expect(fk.children()).toEqual([]);
  });

  describe('isEqualTo', () => {
    it('true when referential actions match', () => {
      const a = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'noAction',
      });
      const b = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onDelete: 'cascade',
        onUpdate: 'noAction',
      });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('false when onDelete differs', () => {
      const a = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onDelete: 'cascade',
      });
      const b = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onDelete: 'restrict',
      });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('false when onUpdate differs', () => {
      const a = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onUpdate: 'cascade',
      });
      const b = new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onUpdate: 'setNull',
      });
      expect(a.isEqualTo(b)).toBe(false);
    });
  });
});
