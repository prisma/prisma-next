import { describe, expect, it } from 'vitest';

import { SqlColumnIR } from '../src/ir/sql-column-ir';

describe('SqlColumnIR', () => {
  it('id is the column name, prefixed by kind', () => {
    const column = new SqlColumnIR({ name: 'email', nativeType: 'text', nullable: false });
    expect(column.id).toBe('column:email');
  });

  it('nodeKind is the column kind', () => {
    const column = new SqlColumnIR({ name: 'email', nativeType: 'text', nullable: false });
    expect(column.nodeKind).toBe('sql-column');
  });

  it('children is empty (a column is a leaf)', () => {
    const column = new SqlColumnIR({ name: 'email', nativeType: 'text', nullable: false });
    expect(column.children()).toEqual([]);
  });

  describe('isEqualTo', () => {
    const base = new SqlColumnIR({
      name: 'email',
      nativeType: 'text',
      nullable: false,
      default: "'x'",
      many: false,
    });

    it('true when every attribute matches', () => {
      const other = new SqlColumnIR({
        name: 'email',
        nativeType: 'text',
        nullable: false,
        default: "'x'",
        many: false,
      });
      expect(base.isEqualTo(other)).toBe(true);
    });

    it('false when nativeType differs', () => {
      const other = new SqlColumnIR({
        name: 'email',
        nativeType: 'varchar',
        nullable: false,
        default: "'x'",
        many: false,
      });
      expect(base.isEqualTo(other)).toBe(false);
    });

    it('false when nullable differs', () => {
      const other = new SqlColumnIR({
        name: 'email',
        nativeType: 'text',
        nullable: true,
        default: "'x'",
        many: false,
      });
      expect(base.isEqualTo(other)).toBe(false);
    });

    it('false when default differs', () => {
      const other = new SqlColumnIR({
        name: 'email',
        nativeType: 'text',
        nullable: false,
        default: "'y'",
        many: false,
      });
      expect(base.isEqualTo(other)).toBe(false);
    });

    it('false when many differs', () => {
      const other = new SqlColumnIR({
        name: 'email',
        nativeType: 'text',
        nullable: false,
        default: "'x'",
        many: true,
      });
      expect(base.isEqualTo(other)).toBe(false);
    });

    it('true when both sides omit default (absent vs absent)', () => {
      const a = new SqlColumnIR({ name: 'id', nativeType: 'int4', nullable: false });
      const b = new SqlColumnIR({ name: 'id', nativeType: 'int4', nullable: false });
      expect(a.isEqualTo(b)).toBe(true);
    });
  });
});
