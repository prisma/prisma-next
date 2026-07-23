import { describe, expect, it } from 'vitest';

import { SqlIndexIR, type SqlIndexIRInput } from '../src/ir/sql-index-ir';

function index(
  input: Pick<SqlIndexIRInput, 'columns' | 'unique' | 'partial'> & Partial<SqlIndexIRInput>,
): SqlIndexIR {
  return new SqlIndexIR({
    name: undefined,
    type: undefined,
    options: undefined,
    annotations: undefined,
    dependsOn: undefined,
    ...input,
  });
}

describe('SqlIndexIR', () => {
  it('id is derived from the column tuple, not name', () => {
    const idx = index({
      columns: ['email'],
      unique: false,
      partial: false,
      name: 'idx_users_email',
    });
    expect(idx.id).toBe('index:email');
  });

  it('two unnamed indexes on the same columns share the same id', () => {
    const a = index({ columns: ['tenant_id'], unique: false, partial: false });
    const b = index({ columns: ['tenant_id'], unique: false, partial: false });
    expect(a.id).toBe(b.id);
  });

  it('nodeKind is the index kind', () => {
    const idx = index({ columns: ['email'], unique: false, partial: false });
    expect(idx.nodeKind).toBe('sql-index');
  });

  it('children is empty (an index is a leaf)', () => {
    const idx = index({ columns: ['email'], unique: false, partial: false });
    expect(idx.children()).toEqual([]);
  });

  it('explicitly-undefined optional values leave the properties absent, not present-as-undefined', () => {
    const idx = new SqlIndexIR({
      columns: ['email'],
      unique: false,
      partial: false,
      name: undefined,
      type: undefined,
      options: undefined,
      annotations: undefined,
      dependsOn: undefined,
    });
    for (const key of ['name', 'type', 'options', 'annotations', 'dependsOn']) {
      expect(Object.hasOwn(idx, key)).toBe(false);
    }
    expect(Object.keys(idx).sort()).toEqual(['columns', 'nodeKind', 'unique']);
    expect(JSON.parse(JSON.stringify(idx))).toEqual({
      nodeKind: 'sql-index',
      columns: ['email'],
      unique: false,
    });
  });

  describe('isEqualTo', () => {
    it('true when unique/type/options all match', () => {
      const a = index({ columns: ['email'], unique: true, partial: false, type: 'btree' });
      const b = index({ columns: ['email'], unique: true, partial: false, type: 'btree' });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('a unique index and a non-unique index are not equal (symmetric — neither direction satisfies)', () => {
      const uniqueIdx = index({ columns: ['email'], unique: true, partial: false });
      const plainIdx = index({ columns: ['email'], unique: false, partial: false });
      expect(uniqueIdx.isEqualTo(plainIdx)).toBe(false);
      expect(plainIdx.isEqualTo(uniqueIdx)).toBe(false);
    });

    it('false when type differs', () => {
      const a = index({
        columns: ['email'],
        unique: false,
        partial: false,
        type: 'btree',
      });
      const b = index({ columns: ['email'], unique: false, partial: false, type: 'gin' });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('false when options differ', () => {
      const a = index({
        columns: ['email'],
        unique: false,
        partial: false,
        options: { fillfactor: 90 },
      });
      const b = index({
        columns: ['email'],
        unique: false,
        partial: false,
        options: { fillfactor: 70 },
      });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('options compare loosely: typed contract value matches introspected string value', () => {
      const contractSide = index({
        columns: ['email'],
        unique: false,
        partial: false,
        options: { fillfactor: 70, fastupdate: true },
      });
      const introspectedSide = index({
        columns: ['email'],
        unique: false,
        partial: false,
        options: { fillfactor: '70', fastupdate: 'true' },
      });
      expect(contractSide.isEqualTo(introspectedSide)).toBe(true);
    });

    it('absent options and empty options compare equal', () => {
      const a = index({ columns: ['email'], unique: false, partial: false });
      const b = index({ columns: ['email'], unique: false, partial: false, options: {} });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('false when option keys differ', () => {
      const a = index({
        columns: ['email'],
        unique: false,
        partial: false,
        options: { fillfactor: 70 },
      });
      const b = index({
        columns: ['email'],
        unique: false,
        partial: false,
        options: { fastupdate: 70 },
      });
      expect(a.isEqualTo(b)).toBe(false);
    });
  });

  describe('partial', () => {
    it('is readable, non-enumerable, and ignored by isEqualTo', () => {
      const partialIdx = index({ columns: ['email'], unique: true, partial: true });
      const totalIdx = index({ columns: ['email'], unique: true, partial: false });
      expect(partialIdx.partial).toBe(true);
      expect(totalIdx.partial).toBe(false);
      expect(Object.keys(partialIdx)).not.toContain('partial');
      expect(Object.keys(totalIdx)).not.toContain('partial');
      expect(JSON.parse(JSON.stringify(partialIdx))).not.toHaveProperty('partial');
      expect(JSON.parse(JSON.stringify(totalIdx))).not.toHaveProperty('partial');
      expect(partialIdx.isEqualTo(totalIdx)).toBe(true);
      expect(totalIdx.isEqualTo(partialIdx)).toBe(true);
    });
  });

  describe('dependsOn', () => {
    const dependsOn = [
      [
        { nodeKind: 'sql-schema', id: 'database' },
        { nodeKind: 'sql-table', id: 'users' },
        { nodeKind: 'sql-column', id: 'column:email' },
      ],
    ];

    it('is readable, non-enumerable, and ignored by isEqualTo', () => {
      const withDeps = index({
        columns: ['email'],
        unique: false,
        partial: false,
        dependsOn,
      });
      const without = index({ columns: ['email'], unique: false, partial: false });
      expect(withDeps.dependsOn).toEqual(dependsOn);
      expect(without.dependsOn).toBeUndefined();
      expect(Object.keys(withDeps)).not.toContain('dependsOn');
      expect(JSON.parse(JSON.stringify(withDeps))).not.toHaveProperty('dependsOn');
      expect(withDeps.isEqualTo(without)).toBe(true);
    });
  });
});
