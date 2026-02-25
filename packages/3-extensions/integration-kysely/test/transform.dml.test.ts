import {
  KYSELY_TRANSFORM_ERROR_CODES,
  KyselyTransformError,
  transformKyselyToPnAst,
} from '@prisma-next/sql-kysely-lane';
import type { DeleteAst, InsertAst, UpdateAst } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { binaryWhere, contract } from './transform.fixtures';

describe('transformKyselyToPnAst — InsertQueryNode', () => {
  it('transforms insert with values', () => {
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
          {
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'email' },
              table: { kind: 'IdentifierNode', name: 'user' },
            },
            value: { kind: 'ValueNode', value: 'e@example.com' },
          },
          {
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'createdAt' },
              table: { kind: 'IdentifierNode', name: 'user' },
            },
            value: { kind: 'ValueNode', value: '2024-01-01' },
          },
        ],
      },
    };
    const result = transformKyselyToPnAst(contract, query, [
      'id-val',
      'e@example.com',
      '2024-01-01',
    ]);
    const insertAst = result.ast as InsertAst;
    expect(insertAst.kind).toBe('insert');
    expect(insertAst.table).toEqual({ kind: 'table', name: 'user' });
    expect(Object.keys(insertAst.values)).toEqual(['id', 'email', 'createdAt']);
  });

  it('throws on multi-row INSERT values', () => {
    const query = {
      kind: 'InsertQueryNode',
      into: { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } },
      columns: [
        { kind: 'ColumnNode', column: { kind: 'IdentifierNode', name: 'id' } },
        { kind: 'ColumnNode', column: { kind: 'IdentifierNode', name: 'email' } },
      ],
      values: {
        kind: 'ValuesNode',
        values: [
          { kind: 'PrimitiveValueListNode', values: ['id1', 'a@x.com'] },
          { kind: 'PrimitiveValueListNode', values: ['id2', 'b@x.com'] },
        ],
      },
    };
    expect(() => transformKyselyToPnAst(contract, query, [])).toThrow(KyselyTransformError);
    try {
      transformKyselyToPnAst(contract, query, []);
    } catch (e) {
      expect((e as KyselyTransformError).code).toBe(KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE);
    }
  });

  it('transforms insert with returning columns', () => {
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
          {
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'email' },
              table: { kind: 'IdentifierNode', name: 'user' },
            },
            value: { kind: 'ValueNode', value: 'e@example.com' },
          },
        ],
      },
      returning: {
        kind: 'ReturningNode',
        selections: [
          {
            kind: 'SelectionNode',
            selection: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'id' },
                table: { kind: 'IdentifierNode', name: 'user' },
              },
            },
          },
          {
            kind: 'SelectionNode',
            selection: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'email' },
                table: { kind: 'IdentifierNode', name: 'user' },
              },
            },
          },
        ],
      },
    };
    const result = transformKyselyToPnAst(contract, query, ['id-val', 'e@example.com']);
    const insertAst = result.ast as InsertAst;
    expect(insertAst.kind).toBe('insert');
    expect(insertAst.returning).toBeDefined();
    expect(insertAst.returning).toHaveLength(2);
    expect(insertAst.returning).toContainEqual({ kind: 'col', table: 'user', column: 'id' });
    expect(insertAst.returning).toContainEqual({ kind: 'col', table: 'user', column: 'email' });
  });
});

describe('transformKyselyToPnAst — UpdateQueryNode', () => {
  it('transforms update with set and where', () => {
    const query = {
      kind: 'UpdateQueryNode',
      table: {
        kind: 'TableNode',
        table: { kind: 'IdentifierNode', name: 'user' },
      },
      updates: [
        {
          column: {
            kind: 'ColumnNode',
            column: { kind: 'IdentifierNode', name: 'email' },
            table: { kind: 'IdentifierNode', name: 'user' },
          },
          value: { kind: 'ValueNode', value: 'new@example.com' },
        },
      ],
      where: binaryWhere('id', 'user-id'),
    };
    const result = transformKyselyToPnAst(contract, query, ['new@example.com', 'user-id']);
    const updateAst = result.ast as UpdateAst;
    expect(updateAst.kind).toBe('update');
    expect(updateAst.where).toBeDefined();
    expect(updateAst.set['email']).toBeDefined();
  });

  it('transforms update with returning columns', () => {
    const query = {
      kind: 'UpdateQueryNode',
      table: {
        kind: 'TableNode',
        table: { kind: 'IdentifierNode', name: 'user' },
      },
      updates: [
        {
          column: {
            kind: 'ColumnNode',
            column: { kind: 'IdentifierNode', name: 'email' },
            table: { kind: 'IdentifierNode', name: 'user' },
          },
          value: { kind: 'ValueNode', value: 'updated@example.com' },
        },
      ],
      where: binaryWhere('id', 'uid'),
      returning: {
        kind: 'ReturningNode',
        selections: [
          {
            kind: 'SelectionNode',
            selection: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'id' },
                table: { kind: 'IdentifierNode', name: 'user' },
              },
            },
          },
        ],
      },
    };
    const result = transformKyselyToPnAst(contract, query, ['updated@example.com', 'uid']);
    const updateAst = result.ast as UpdateAst;
    expect(updateAst.kind).toBe('update');
    expect(updateAst.returning).toBeDefined();
    expect(updateAst.returning).toHaveLength(1);
    expect(updateAst.returning?.[0]).toEqual({ kind: 'col', table: 'user', column: 'id' });
  });
});

describe('transformKyselyToPnAst — DeleteQueryNode', () => {
  it('transforms delete with where', () => {
    const query = {
      kind: 'DeleteQueryNode',
      from: {
        kind: 'TableNode',
        table: { kind: 'IdentifierNode', name: 'user' },
      },
      where: binaryWhere('id', 'user-id'),
    };
    const result = transformKyselyToPnAst(contract, query, ['user-id']);
    const deleteWithWhere = result.ast as DeleteAst;
    expect(deleteWithWhere.kind).toBe('delete');
    expect(deleteWithWhere.where).toBeDefined();
  });

  it('transforms delete without where', () => {
    const query = {
      kind: 'DeleteQueryNode',
      from: {
        kind: 'TableNode',
        table: { kind: 'IdentifierNode', name: 'user' },
      },
    };
    const result = transformKyselyToPnAst(contract, query, []);
    const deleteNoWhere = result.ast as DeleteAst;
    expect(deleteNoWhere.kind).toBe('delete');
    expect(deleteNoWhere.where).toBeUndefined();
  });

  it('transforms delete with returning columns', () => {
    const query = {
      kind: 'DeleteQueryNode',
      from: {
        kind: 'TableNode',
        table: { kind: 'IdentifierNode', name: 'user' },
      },
      where: binaryWhere('id', 'uid'),
      returning: {
        kind: 'ReturningNode',
        selections: [
          {
            kind: 'SelectionNode',
            selection: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'id' },
                table: { kind: 'IdentifierNode', name: 'user' },
              },
            },
          },
          {
            kind: 'SelectionNode',
            selection: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'email' },
                table: { kind: 'IdentifierNode', name: 'user' },
              },
            },
          },
        ],
      },
    };
    const result = transformKyselyToPnAst(contract, query, ['uid']);
    const deleteAst = result.ast as DeleteAst;
    expect(deleteAst.kind).toBe('delete');
    expect(deleteAst.returning).toBeDefined();
    expect(deleteAst.returning).toHaveLength(2);
  });
});
