import { describe, expect, it } from 'vitest';

import { SqlIndexIR, type SqlIndexIRInput } from '../src/ir/sql-index-ir';

function index(
  input: Pick<SqlIndexIRInput, 'name' | 'unique' | 'partial'> & Partial<SqlIndexIRInput>,
): SqlIndexIR {
  return new SqlIndexIR({
    prefix: undefined,
    columns: input.columns !== undefined || input.expression !== undefined ? undefined : ['email'],
    expression: undefined,
    where: undefined,
    type: undefined,
    options: undefined,
    annotations: undefined,
    dependsOn: undefined,
    ...input,
  });
}

function managed(input: Partial<SqlIndexIRInput> & Pick<SqlIndexIRInput, 'name'>): SqlIndexIR {
  return index({ unique: false, partial: false, prefix: 'user_email_idx', ...input });
}

function exact(input: Partial<SqlIndexIRInput> & Pick<SqlIndexIRInput, 'name'>): SqlIndexIR {
  return index({ unique: false, partial: false, ...input });
}

const NAME = 'user_email_idx_46df9cad';

describe('SqlIndexIR', () => {
  it('id is the name (name identity), kind-prefixed against sibling collisions', () => {
    const idx = exact({ name: 'idx_users_email', columns: ['email'] });
    expect(idx.id).toBe('index:idx_users_email');
  });

  it('two same-tuple indexes with different names have distinct ids (twins are representable)', () => {
    const a = exact({ name: 'user_email_key', columns: ['email'], unique: true });
    const b = exact({ name: 'user_email_plain_idx', columns: ['email'] });
    expect(a.id).not.toBe(b.id);
  });

  it('rejects both columns and expression, and neither', () => {
    expect(() =>
      index({
        name: 'x',
        unique: false,
        partial: false,
        columns: ['email'],
        expression: 'lower(email)',
      }),
    ).toThrow(/exactly one of columns or expression/);
    expect(
      () =>
        new SqlIndexIR({
          name: 'x',
          prefix: undefined,
          columns: undefined,
          expression: undefined,
          where: undefined,
          unique: false,
          partial: false,
          type: undefined,
          options: undefined,
          annotations: undefined,
          dependsOn: undefined,
        }),
    ).toThrow(/exactly one of columns or expression/);
  });

  it('nodeKind is the index kind and children is empty', () => {
    const idx = exact({ name: 'x', columns: ['email'] });
    expect(idx.nodeKind).toBe('sql-index');
    expect(idx.children()).toEqual([]);
  });

  it('explicitly-undefined optional values leave the properties absent, not present-as-undefined', () => {
    const idx = exact({ name: 'user_email_idx', columns: ['email'] });
    for (const key of [
      'prefix',
      'expression',
      'where',
      'type',
      'options',
      'annotations',
      'dependsOn',
    ]) {
      expect(Object.hasOwn(idx, key)).toBe(false);
    }
    expect(Object.keys(idx).sort()).toEqual(['columns', 'name', 'nodeKind', 'unique']);
    expect(JSON.parse(JSON.stringify(idx))).toEqual({
      nodeKind: 'sql-index',
      name: 'user_email_idx',
      columns: ['email'],
      unique: false,
    });
  });

  describe('isEqualTo — both modes (structural attributes)', () => {
    it('true when unique/type/options/columns all match', () => {
      const a = managed({ name: NAME, columns: ['email'], unique: true, type: 'gin' });
      const b = exact({ name: NAME, columns: ['email'], unique: true, type: 'gin' });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('a unique index and a non-unique index are not equal (symmetric)', () => {
      const uniqueIdx = managed({ name: NAME, columns: ['email'], unique: true });
      const plainIdx = exact({ name: NAME, columns: ['email'] });
      expect(uniqueIdx.isEqualTo(plainIdx)).toBe(false);
      expect(plainIdx.isEqualTo(uniqueIdx)).toBe(false);
    });

    it('false when type differs (managed side detects drift)', () => {
      const a = managed({ name: NAME, columns: ['email'], type: 'btree' });
      const b = exact({ name: NAME, columns: ['email'], type: 'gin' });
      expect(a.isEqualTo(b)).toBe(false);
    });

    it('false when options differ; loose String() coercion still applies', () => {
      const drifted = managed({ name: NAME, columns: ['email'], options: { fillfactor: 90 } });
      const live = exact({ name: NAME, columns: ['email'], options: { fillfactor: '70' } });
      expect(drifted.isEqualTo(live)).toBe(false);

      const typed = managed({ name: NAME, columns: ['email'], options: { fillfactor: 70 } });
      const stringly = exact({ name: NAME, columns: ['email'], options: { fillfactor: '70' } });
      expect(typed.isEqualTo(stringly)).toBe(true);
    });

    it('absent options and empty options compare equal', () => {
      const a = managed({ name: NAME, columns: ['email'] });
      const b = exact({ name: NAME, columns: ['email'], options: {} });
      expect(a.isEqualTo(b)).toBe(true);
    });

    it('columns compare ordered-strict when both sides carry them', () => {
      const ab = managed({ name: NAME, columns: ['a', 'b'] });
      const ba = exact({ name: NAME, columns: ['b', 'a'] });
      const abAgain = exact({ name: NAME, columns: ['a', 'b'] });
      expect(ab.isEqualTo(ba)).toBe(false);
      expect(ab.isEqualTo(abAgain)).toBe(true);
    });

    it('columns are skipped when either side is an expression node', () => {
      const managedColumns = managed({ name: NAME, columns: ['email'] });
      const liveExpression = exact({ name: NAME, expression: 'lower(email)' });
      expect(managedColumns.isEqualTo(liveExpression)).toBe(true);
    });
  });

  describe('isEqualTo — managed mode never compares bodies', () => {
    it('expression and where drift is invisible to a managed expected node', () => {
      const expected = managed({ name: NAME, expression: 'lower(email)', where: 'x > 1' });
      const actual = exact({ name: NAME, expression: 'upper(email)', where: 'x > 2' });
      expect(expected.isEqualTo(actual)).toBe(true);
    });
  });

  describe('isEqualTo — exact mode compares bodies byte-for-byte', () => {
    it('fires on expression reprint drift', () => {
      const expected = exact({ name: 'users_email_eq', expression: 'lower(email)' });
      const actual = exact({ name: 'users_email_eq', expression: 'lower((email)::text)' });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('fires on where drift', () => {
      const expected = exact({
        name: 'users_active_idx',
        columns: ['email'],
        where: '(deleted_at IS NULL)',
      });
      const actual = exact({
        name: 'users_active_idx',
        columns: ['email'],
        where: '(archived_at IS NULL)',
      });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('no normalization: whitespace variants of the same body are unequal', () => {
      const expected = exact({ name: 'users_email_eq', expression: 'lower(email)' });
      const actual = exact({ name: 'users_email_eq', expression: 'lower( email )' });
      expect(expected.isEqualTo(actual)).toBe(false);
    });

    it('absent bodies equal empty bodies (fields-only exact indexes stay equal)', () => {
      const expected = exact({ name: 'users_email_idx', columns: ['email'] });
      const actual = exact({ name: 'users_email_idx', columns: ['email'], where: '' });
      expect(expected.isEqualTo(actual)).toBe(true);
    });

    it('matching bodies are equal', () => {
      const expected = exact({
        name: 'users_email_eq',
        expression: 'lower(email)',
        where: '(deleted_at IS NULL)',
      });
      const actual = exact({
        name: 'users_email_eq',
        expression: 'lower(email)',
        where: '(deleted_at IS NULL)',
      });
      expect(expected.isEqualTo(actual)).toBe(true);
    });
  });

  describe('partial', () => {
    it('is readable, non-enumerable, and ignored by isEqualTo', () => {
      const partialIdx = managed({ name: NAME, columns: ['email'], unique: true, partial: true });
      const totalIdx = exact({ name: NAME, columns: ['email'], unique: true });
      expect(partialIdx.partial).toBe(true);
      expect(totalIdx.partial).toBe(false);
      expect(Object.keys(partialIdx)).not.toContain('partial');
      expect(JSON.parse(JSON.stringify(partialIdx))).not.toHaveProperty('partial');
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
      const withDeps = managed({ name: NAME, columns: ['email'], dependsOn });
      const without = exact({ name: NAME, columns: ['email'] });
      expect(withDeps.dependsOn).toEqual(dependsOn);
      expect(without.dependsOn).toBeUndefined();
      expect(Object.keys(withDeps)).not.toContain('dependsOn');
      expect(JSON.parse(JSON.stringify(withDeps))).not.toHaveProperty('dependsOn');
      expect(withDeps.isEqualTo(without)).toBe(true);
    });
  });
});
