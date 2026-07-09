import { describe, expect, it } from 'vitest';

import { SqlCheckConstraintIR } from '../src/ir/sql-check-constraint-ir';

describe('SqlCheckConstraintIR', () => {
  it('id is the constraint name, prefixed by kind', () => {
    const check = new SqlCheckConstraintIR({
      name: 'chk_status',
      column: 'status',
      permittedValues: ['active', 'inactive'],
    });
    expect(check.id).toBe('check:chk_status');
  });

  it('nodeKind is the check kind', () => {
    const check = new SqlCheckConstraintIR({
      name: 'chk_status',
      column: 'status',
      permittedValues: ['active'],
    });
    expect(check.nodeKind).toBe('sql-check-constraint');
  });

  it('children is empty (a check constraint is a leaf)', () => {
    const check = new SqlCheckConstraintIR({
      name: 'chk_status',
      column: 'status',
      permittedValues: ['active'],
    });
    expect(check.children()).toEqual([]);
  });

  describe('isEqualTo', () => {
    it('true when column and permitted values match', () => {
      const a = new SqlCheckConstraintIR({
        name: 'chk_status',
        column: 'status',
        permittedValues: ['active', 'inactive'],
      });
      const b = new SqlCheckConstraintIR({
        name: 'chk_status',
        column: 'status',
        permittedValues: ['active', 'inactive'],
      });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('true when permitted values match out of order', () => {
      const a = new SqlCheckConstraintIR({
        name: 'chk_status',
        column: 'status',
        permittedValues: ['active', 'inactive'],
      });
      const b = new SqlCheckConstraintIR({
        name: 'chk_status',
        column: 'status',
        permittedValues: ['inactive', 'active'],
      });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('column is descriptive, not compared (legacy pairs by name, compares values only)', () => {
      const a = new SqlCheckConstraintIR({
        name: 'chk_status',
        column: 'status',
        permittedValues: ['active'],
      });
      const b = new SqlCheckConstraintIR({
        name: 'chk_status',
        column: 'state',
        permittedValues: ['active'],
      });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('false when a permitted value is added', () => {
      const a = new SqlCheckConstraintIR({
        name: 'chk_status',
        column: 'status',
        permittedValues: ['active'],
      });
      const b = new SqlCheckConstraintIR({
        name: 'chk_status',
        column: 'status',
        permittedValues: ['active', 'inactive'],
      });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('false when a permitted value is removed', () => {
      const a = new SqlCheckConstraintIR({
        name: 'chk_status',
        column: 'status',
        permittedValues: ['active', 'inactive'],
      });
      const b = new SqlCheckConstraintIR({
        name: 'chk_status',
        column: 'status',
        permittedValues: ['active'],
      });
      expect(a.isEqualTo(b)).toBe(false);
    });
  });
});
