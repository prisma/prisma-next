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

  describe('resolved fields', () => {
    it('carries resolvedNativeType and resolvedDefault when supplied', () => {
      const column = new SqlColumnIR({
        name: 'email',
        nativeType: 'character varying(255)',
        nullable: false,
        resolvedNativeType: 'character varying(255)',
        resolvedDefault: { kind: 'literal', value: 'x' },
      });
      expect(column.resolvedNativeType).toBe('character varying(255)');
      expect(column.resolvedDefault).toEqual({ kind: 'literal', value: 'x' });
    });
  });

  describe('isEqualTo with resolved values (expected = this, actual = other)', () => {
    it('compares resolvedNativeType when both sides carry it, ignoring raw drift', () => {
      const expected = new SqlColumnIR({
        name: 'email',
        nativeType: 'character varying(255)',
        nullable: false,
        resolvedNativeType: 'character varying(255)',
      });
      const actual = new SqlColumnIR({
        name: 'email',
        nativeType: 'varchar(255)',
        nullable: false,
        resolvedNativeType: 'character varying(255)',
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('false when resolvedNativeType differs', () => {
      const expected = new SqlColumnIR({
        name: 'n',
        nativeType: 'int4',
        nullable: false,
        resolvedNativeType: 'int4',
      });
      const actual = new SqlColumnIR({
        name: 'n',
        nativeType: 'int4',
        nullable: false,
        resolvedNativeType: 'int8',
      });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('array-ness rides on resolvedNativeType ([] suffix), not the many flag', () => {
      const expected = new SqlColumnIR({
        name: 'tags',
        nativeType: 'text[]',
        nullable: false,
        resolvedNativeType: 'text[]',
      });
      const actual = new SqlColumnIR({
        name: 'tags',
        nativeType: 'text',
        nullable: false,
        many: true,
        resolvedNativeType: 'text[]',
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('literal defaults compare structurally via resolvedDefault, ignoring raw strings', () => {
      const expected = new SqlColumnIR({
        name: 'status',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
        resolvedDefault: { kind: 'literal', value: 'draft' },
      });
      const actual = new SqlColumnIR({
        name: 'status',
        nativeType: 'text',
        nullable: false,
        default: "'draft'::text",
        resolvedNativeType: 'text',
        resolvedDefault: { kind: 'literal', value: 'draft' },
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('false when literal default values differ', () => {
      const expected = new SqlColumnIR({
        name: 'status',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
        resolvedDefault: { kind: 'literal', value: 'draft' },
      });
      const actual = new SqlColumnIR({
        name: 'status',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
        resolvedDefault: { kind: 'literal', value: 'published' },
      });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('function default expressions compare case- and whitespace-insensitively', () => {
      const expected = new SqlColumnIR({
        name: 'created_at',
        nativeType: 'timestamptz',
        nullable: false,
        resolvedNativeType: 'timestamptz',
        resolvedDefault: { kind: 'function', expression: 'NOW()' },
      });
      const actual = new SqlColumnIR({
        name: 'created_at',
        nativeType: 'timestamptz',
        nullable: false,
        resolvedNativeType: 'timestamptz',
        resolvedDefault: { kind: 'function', expression: 'now ()' },
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('temporal literal defaults compare by instant: Date vs equivalent ISO string', () => {
      const expected = new SqlColumnIR({
        name: 'expires',
        nativeType: 'timestamptz',
        nullable: false,
        resolvedNativeType: 'timestamptz',
        resolvedDefault: { kind: 'literal', value: new Date('2024-01-02T03:04:05.000Z') },
      });
      const actual = new SqlColumnIR({
        name: 'expires',
        nativeType: 'timestamptz',
        nullable: false,
        resolvedNativeType: 'timestamptz',
        resolvedDefault: { kind: 'literal', value: '2024-01-02 03:04:05+00' },
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('JSON literal defaults compare canonically: object vs equivalent JSON string', () => {
      const expected = new SqlColumnIR({
        name: 'settings',
        nativeType: 'jsonb',
        nullable: false,
        resolvedNativeType: 'jsonb',
        resolvedDefault: { kind: 'literal', value: { a: 1, b: 2 } },
      });
      const actual = new SqlColumnIR({
        name: 'settings',
        nativeType: 'jsonb',
        nullable: false,
        resolvedNativeType: 'jsonb',
        resolvedDefault: { kind: 'literal', value: '{"b":2,"a":1}' },
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('false when kinds differ (literal vs function)', () => {
      const expected = new SqlColumnIR({
        name: 'c',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
        resolvedDefault: { kind: 'literal', value: 'now()' },
      });
      const actual = new SqlColumnIR({
        name: 'c',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
        resolvedDefault: { kind: 'function', expression: 'now()' },
      });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('false when the expected default is declared but the actual carries only an unparseable raw default', () => {
      const expected = new SqlColumnIR({
        name: 'c',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
        resolvedDefault: { kind: 'literal', value: 'x' },
      });
      const actual = new SqlColumnIR({
        name: 'c',
        nativeType: 'text',
        nullable: false,
        default: 'some_unparseable_expr()',
        resolvedNativeType: 'text',
      });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('false when the expected has no default but the actual does', () => {
      const expected = new SqlColumnIR({
        name: 'c',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
      });
      const actual = new SqlColumnIR({
        name: 'c',
        nativeType: 'text',
        nullable: false,
        default: "'x'::text",
        resolvedNativeType: 'text',
        resolvedDefault: { kind: 'literal', value: 'x' },
      });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('true when neither side declares a default in resolved mode', () => {
      const expected = new SqlColumnIR({
        name: 'c',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
      });
      const actual = new SqlColumnIR({
        name: 'c',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('falls back to raw comparison when either side lacks resolvedNativeType', () => {
      const withResolved = new SqlColumnIR({
        name: 'c',
        nativeType: 'text',
        nullable: false,
        resolvedNativeType: 'text',
      });
      const rawOnly = new SqlColumnIR({ name: 'c', nativeType: 'text', nullable: false });
      expect(withResolved.isEqualTo(rawOnly)).toBe(true);
      expect(rawOnly.isEqualTo(withResolved)).toBe(true);
    });
  });
});
