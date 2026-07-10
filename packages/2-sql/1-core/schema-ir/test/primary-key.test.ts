import { describe, expect, it } from 'vitest';

import { PrimaryKey } from '../src/ir/primary-key';

describe('PrimaryKey', () => {
  it('id is the fixed sentinel regardless of columns/name', () => {
    const a = new PrimaryKey({ columns: ['id'] });
    const b = new PrimaryKey({ columns: ['tenant_id', 'id'], name: 'pk_foo' });
    expect(a.id).toBe('primary-key');
    expect(b.id).toBe('primary-key');
  });

  it('nodeKind is the primary-key kind', () => {
    const pk = new PrimaryKey({ columns: ['id'] });
    expect(pk.nodeKind).toBe('sql-primary-key');
  });

  it('children is empty (a primary key is a leaf)', () => {
    const pk = new PrimaryKey({ columns: ['id'] });
    expect(pk.children()).toEqual([]);
  });

  describe('isEqualTo', () => {
    it('true when the column tuple matches, ignoring name', () => {
      const a = new PrimaryKey({ columns: ['tenant_id', 'id'], name: 'pk_a' });
      const b = new PrimaryKey({ columns: ['tenant_id', 'id'], name: 'pk_b' });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('false when the column set differs', () => {
      const a = new PrimaryKey({ columns: ['id'] });
      const b = new PrimaryKey({ columns: ['tenant_id', 'id'] });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('false when column order differs', () => {
      const a = new PrimaryKey({ columns: ['tenant_id', 'id'] });
      const b = new PrimaryKey({ columns: ['id', 'tenant_id'] });
      expect(a.isEqualTo(b)).toBe(false);
    });
  });
});
