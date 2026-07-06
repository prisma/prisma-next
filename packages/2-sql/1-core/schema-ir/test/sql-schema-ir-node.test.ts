import { describe, expect, it } from 'vitest';

import { PrimaryKey } from '../src/ir/primary-key';
import { SqlCheckConstraintIR } from '../src/ir/sql-check-constraint-ir';
import { SqlColumnIR } from '../src/ir/sql-column-ir';
import { SqlForeignKeyIR } from '../src/ir/sql-foreign-key-ir';
import { SqlIndexIR } from '../src/ir/sql-index-ir';
import { SqlSchemaIR } from '../src/ir/sql-schema-ir';
import { SqlTableIR } from '../src/ir/sql-table-ir';
import { SqlUniqueIR } from '../src/ir/sql-unique-ir';

/**
 * `kind` stays non-enumerable so serialization stays canonical and `toEqual`
 * against flat literals keeps passing — this was the A08 concern the
 * required-discriminant change must not regress. `nodeKind` stays enumerable
 * so it survives a spread.
 */
describe('SqlSchemaIRNode discriminants', () => {
  it.each([
    ['SqlColumnIR', new SqlColumnIR({ name: 'id', nativeType: 'int4', nullable: false })],
    ['PrimaryKey', new PrimaryKey({ columns: ['id'] })],
    [
      'SqlForeignKeyIR',
      new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
      }),
    ],
    ['SqlUniqueIR', new SqlUniqueIR({ columns: ['email'] })],
    ['SqlIndexIR', new SqlIndexIR({ columns: ['email'], unique: false })],
    [
      'SqlCheckConstraintIR',
      new SqlCheckConstraintIR({ name: 'chk', column: 'status', permittedValues: ['a'] }),
    ],
  ] as const)('%s: kind is non-enumerable, absent from JSON and toEqual', (_label, node) => {
    expect(Object.keys(node)).not.toContain('kind');
    expect(JSON.parse(JSON.stringify(node))).not.toHaveProperty('kind');
    expect(node.kind).toBe('sql-schema-ir');
  });

  it.each([
    [
      'SqlColumnIR',
      new SqlColumnIR({ name: 'id', nativeType: 'int4', nullable: false }),
      'sql-column',
    ],
    ['PrimaryKey', new PrimaryKey({ columns: ['id'] }), 'sql-primary-key'],
    [
      'SqlForeignKeyIR',
      new SqlForeignKeyIR({
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
      }),
      'sql-foreign-key',
    ],
    ['SqlUniqueIR', new SqlUniqueIR({ columns: ['email'] }), 'sql-unique'],
    ['SqlIndexIR', new SqlIndexIR({ columns: ['email'], unique: false }), 'sql-index'],
    [
      'SqlCheckConstraintIR',
      new SqlCheckConstraintIR({ name: 'chk', column: 'status', permittedValues: ['a'] }),
      'sql-check-constraint',
    ],
    [
      'SqlTableIR',
      new SqlTableIR({ name: 't', columns: {}, foreignKeys: [], uniques: [], indexes: [] }),
      'sql-table',
    ],
    ['SqlSchemaIR', new SqlSchemaIR({ tables: {} }), 'sql-schema'],
  ] as const)('%s: nodeKind is enumerable and JSON-visible', (_label, node, expectedKind) => {
    expect(node.nodeKind).toBe(expectedKind);
    expect(Object.keys(node)).toContain('nodeKind');
    expect(JSON.parse(JSON.stringify(node))).toHaveProperty('nodeKind', expectedKind);
  });

  it('a column still matches a pre-lift flat literal via toEqual', () => {
    const column = new SqlColumnIR({ name: 'id', nativeType: 'int4', nullable: false });
    expect(column).toEqual({
      name: 'id',
      nativeType: 'int4',
      nullable: false,
      nodeKind: 'sql-column',
    });
  });
});
