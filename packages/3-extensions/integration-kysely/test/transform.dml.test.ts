import type { DeleteAst, InsertAst, UpdateAst } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from '../src/transform/errors';
import { transformKyselyToPnAst } from '../src/transform/transform';
import { compileQuery, compilerDb, contract } from './transform.fixtures';

describe('transformKyselyToPnAst — InsertQueryNode', () => {
  it('transforms insert with values from compiled query', () => {
    const compiled = compileQuery(
      compilerDb.insertInto('user').values({
        id: 'id-val',
        email: 'e@example.com',
        createdAt: '2024-01-01',
      }),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const insertAst = result.ast as InsertAst;

    expect(insertAst.kind).toBe('insert');
    expect(insertAst.table).toEqual({ kind: 'table', name: 'user' });
    expect(Object.keys(insertAst.values)).toEqual(['id', 'email', 'createdAt']);
    expect(result.metaAdditions.paramDescriptors).toHaveLength(3);
  });

  it('throws on multi-row INSERT values from compiled query', () => {
    const compiled = compileQuery(
      compilerDb.insertInto('user').values([
        { id: 'id1', email: 'a@x.com', createdAt: '2024-01-01' },
        { id: 'id2', email: 'b@x.com', createdAt: '2024-01-02' },
      ]),
    );

    expect(() => transformKyselyToPnAst(contract, compiled.query, compiled.parameters)).toThrow(
      KyselyTransformError,
    );

    try {
      transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    } catch (error) {
      expect((error as KyselyTransformError).code).toBe(
        KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
      );
    }
  });

  it('transforms insert returning columns from compiled query', () => {
    const compiled = compileQuery(
      compilerDb
        .insertInto('user')
        .values({ id: 'id-val', email: 'e@example.com', createdAt: '2024-01-01' })
        .returning(['id', 'email']),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const insertAst = result.ast as InsertAst;

    expect(insertAst.returning).toEqual([
      { kind: 'col', table: 'user', column: 'id' },
      { kind: 'col', table: 'user', column: 'email' },
    ]);
  });

  it('throws on unsupported returning expression', () => {
    const query = {
      kind: 'InsertQueryNode',
      into: {
        kind: 'TableNode',
        table: { kind: 'IdentifierNode', name: 'user' },
      },
      values: {
        kind: 'ValuesNode',
        values: [
          {
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'id' },
              table: { kind: 'IdentifierNode', name: 'user' },
            },
            value: { kind: 'ValueNode', value: 'id-val' },
          },
        ],
      },
      returning: {
        kind: 'ReturningNode',
        selections: [
          {
            kind: 'SelectionNode',
            selection: { kind: 'ValueNode', value: 1 },
          },
        ],
      },
    };
    expect(() => transformKyselyToPnAst(contract, query, ['id-val'])).toThrow(KyselyTransformError);
    try {
      transformKyselyToPnAst(contract, query, ['id-val']);
    } catch (e) {
      expect((e as KyselyTransformError).code).toBe(KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE);
    }
  });

  it('throws when insert value is non-parameter literal', () => {
    const query = {
      kind: 'InsertQueryNode',
      into: {
        kind: 'TableNode',
        table: { kind: 'IdentifierNode', name: 'user' },
      },
      values: {
        kind: 'ValuesNode',
        values: [
          {
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'id' },
              table: { kind: 'IdentifierNode', name: 'user' },
            },
            value: 'id-val',
          },
        ],
      },
    };
    expect(() => transformKyselyToPnAst(contract, query, [])).toThrow(KyselyTransformError);
  });

  it('throws on unsupported values entry shape', () => {
    const query = {
      kind: 'InsertQueryNode',
      into: { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } },
      values: {
        kind: 'ValuesNode',
        values: [
          {
            kind: 'UnsupportedValuesNode',
          },
        ],
      },
    };
    expect(() => transformKyselyToPnAst(contract, query, [])).toThrow(KyselyTransformError);
  });
});

describe('transformKyselyToPnAst — UpdateQueryNode', () => {
  it('transforms update with set and where from compiled query', () => {
    const compiled = compileQuery(
      compilerDb.updateTable('user').set({ email: 'new@example.com' }).where('id', '=', 'user-id'),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const updateAst = result.ast as UpdateAst;

    expect(updateAst.kind).toBe('update');
    expect(updateAst.where).toMatchObject({
      kind: 'bin',
      left: { kind: 'col', table: 'user', column: 'id' },
      op: 'eq',
    });
    expect(updateAst.set['email']).toMatchObject({ kind: 'param', index: 1 });
  });

  it('expands update returningAll SelectionNode wrappers', () => {
    const compiled = compileQuery(
      compilerDb
        .updateTable('user')
        .set({ email: 'updated@example.com' })
        .where('id', '=', 'uid')
        .returningAll(),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const updateAst = result.ast as UpdateAst;

    expect(updateAst.returning).toEqual([
      { kind: 'col', table: 'user', column: 'createdAt' },
      { kind: 'col', table: 'user', column: 'email' },
      { kind: 'col', table: 'user', column: 'id' },
    ]);
  });
});

describe('transformKyselyToPnAst — DeleteQueryNode', () => {
  it('transforms delete with where from compiled query', () => {
    const compiled = compileQuery(compilerDb.deleteFrom('user').where('id', '=', 'user-id'));

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const deleteAst = result.ast as DeleteAst;

    expect(deleteAst.kind).toBe('delete');
    expect(deleteAst.where).toMatchObject({
      kind: 'bin',
      left: { kind: 'col', table: 'user', column: 'id' },
      op: 'eq',
    });
  });

  it('transforms delete without where', () => {
    const compiled = compileQuery(compilerDb.deleteFrom('user'));

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const deleteAst = result.ast as DeleteAst;

    expect(deleteAst.kind).toBe('delete');
    expect(deleteAst.where).toBeUndefined();
  });

  it('transforms delete returning columns', () => {
    const compiled = compileQuery(
      compilerDb.deleteFrom('user').where('id', '=', 'uid').returning(['id', 'email']),
    );

    const result = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
    const deleteAst = result.ast as DeleteAst;

    expect(deleteAst.returning).toEqual([
      { kind: 'col', table: 'user', column: 'id' },
      { kind: 'col', table: 'user', column: 'email' },
    ]);
  });
});
