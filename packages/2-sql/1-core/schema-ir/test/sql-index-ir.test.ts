import { describe, expect, it } from 'vitest';

import { SqlIndexIR } from '../src/ir/sql-index-ir';

describe('SqlIndexIR', () => {
  it('id is derived from the column tuple, not name', () => {
    const index = new SqlIndexIR({ columns: ['email'], unique: false, name: 'idx_users_email' });
    expect(index.id).toBe('index:email');
  });

  it('two unnamed indexes on the same columns share the same id', () => {
    const a = new SqlIndexIR({ columns: ['tenant_id'], unique: false });
    const b = new SqlIndexIR({ columns: ['tenant_id'], unique: false });
    expect(a.id).toBe(b.id);
  });

  it('nodeKind is the index kind', () => {
    const index = new SqlIndexIR({ columns: ['email'], unique: false });
    expect(index.nodeKind).toBe('sql-index');
  });

  it('children is empty (an index is a leaf)', () => {
    const index = new SqlIndexIR({ columns: ['email'], unique: false });
    expect(index.children()).toEqual([]);
  });

  describe('isEqualTo', () => {
    it('true when unique/type/options all match', () => {
      const a = new SqlIndexIR({ columns: ['email'], unique: true, type: 'btree' });
      const b = new SqlIndexIR({ columns: ['email'], unique: true, type: 'btree' });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('false when unique differs', () => {
      const a = new SqlIndexIR({ columns: ['email'], unique: true });
      const b = new SqlIndexIR({ columns: ['email'], unique: false });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('false when type differs', () => {
      const a = new SqlIndexIR({ columns: ['email'], unique: false, type: 'btree' });
      const b = new SqlIndexIR({ columns: ['email'], unique: false, type: 'gin' });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('false when options differ', () => {
      const a = new SqlIndexIR({ columns: ['email'], unique: false, options: { fillfactor: 90 } });
      const b = new SqlIndexIR({ columns: ['email'], unique: false, options: { fillfactor: 70 } });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('options compare loosely: typed contract value matches introspected string value', () => {
      const contractSide = new SqlIndexIR({
        columns: ['email'],
        unique: false,
        options: { fillfactor: 70, fastupdate: true },
      });
      const introspectedSide = new SqlIndexIR({
        columns: ['email'],
        unique: false,
        options: { fillfactor: '70', fastupdate: 'true' },
      });
      expect(contractSide.isEqualTo(introspectedSide)).toBe(true);
    });

    it('absent options and empty options compare equal', () => {
      const a = new SqlIndexIR({ columns: ['email'], unique: false });
      const b = new SqlIndexIR({ columns: ['email'], unique: false, options: {} });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('false when option keys differ', () => {
      const a = new SqlIndexIR({ columns: ['email'], unique: false, options: { fillfactor: 70 } });
      const b = new SqlIndexIR({ columns: ['email'], unique: false, options: { fastupdate: 70 } });
      expect(a.isEqualTo(b)).toBe(false);
    });
  });
});
