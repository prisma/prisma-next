import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { transformKyselyToPnAst } from '../src/transform/transform';
import { binaryWhere, contract, selectQueryFixture } from './transform.fixtures';

describe('transformKyselyToPnAst — SelectQueryNode', () => {
  it('transforms simple select all', () => {
    const result = transformKyselyToPnAst(contract, selectQueryFixture(), []);
    const selectAst = result.ast as SelectAst;
    expect(selectAst.kind).toBe('select');
    expect(selectAst.from).toEqual({ kind: 'table', name: 'user' });
    expect(selectAst.project).toHaveLength(3);
    expect(result.metaAdditions.refs.tables).toContain('user');
  });

  it('transforms where with param', () => {
    const query = selectQueryFixture({
      where: binaryWhere('id', 'placeholder'),
    });
    const result = transformKyselyToPnAst(contract, query, ['user_123']);
    const selectWithWhere = result.ast as SelectAst;
    expect(selectWithWhere.where?.kind).toBe('bin');
    expect(selectWithWhere.where).toMatchObject({
      kind: 'bin',
      op: 'eq',
      left: { kind: 'col', table: 'user', column: 'id' },
    });
    expect(result.metaAdditions.paramDescriptors).toHaveLength(1);
    expect(result.metaAdditions.paramDescriptors[0]).toMatchObject({
      source: 'lane',
      refs: { table: 'user', column: 'id' },
    });
  });

  it('transforms limit', () => {
    const query = selectQueryFixture({
      limit: {
        kind: 'LimitNode',
        limit: { kind: 'ValueNode', value: 10 },
      },
    });
    const result = transformKyselyToPnAst(contract, query, [10]);
    const selectWithLimit = result.ast as SelectAst;
    expect(selectWithLimit.limit).toBe(10);
  });

  it('transforms like predicate', () => {
    const query = selectQueryFixture({
      where: {
        kind: 'WhereNode',
        node: {
          kind: 'BinaryOperationNode',
          left: {
            kind: 'ReferenceNode',
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'email' },
              table: { kind: 'IdentifierNode', name: 'user' },
            },
          },
          operator: { kind: 'OperatorNode', operator: 'like' },
          right: { kind: 'ValueNode', value: '%@test.com' },
        },
      },
    });
    const result = transformKyselyToPnAst(contract, query, ['%@test.com']);
    const selectAst = result.ast as SelectAst;
    expect(selectAst.where?.kind).toBe('bin');
    expect(selectAst.where).toMatchObject({
      kind: 'bin',
      op: 'like',
      left: { kind: 'col', table: 'user', column: 'email' },
    });
  });

  it('transforms in predicate', () => {
    const query = selectQueryFixture({
      where: {
        kind: 'WhereNode',
        node: {
          kind: 'BinaryOperationNode',
          left: {
            kind: 'ReferenceNode',
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'id' },
              table: { kind: 'IdentifierNode', name: 'user' },
            },
          },
          operator: { kind: 'OperatorNode', operator: 'in' },
          right: {
            kind: 'PrimitiveValueListNode',
            values: [
              { kind: 'ValueNode', value: 'a' },
              { kind: 'ValueNode', value: 'b' },
              { kind: 'ValueNode', value: 'c' },
            ],
          },
        },
      },
    });
    const result = transformKyselyToPnAst(contract, query, ['a', 'b', 'c']);
    const selectAst = result.ast as SelectAst;
    expect(selectAst.where?.kind).toBe('bin');
    expect(selectAst.where).toMatchObject({
      kind: 'bin',
      op: 'in',
      left: { kind: 'col', table: 'user', column: 'id' },
      right: { kind: 'listLiteral', values: expect.any(Array) },
    });
    const whereRight = (selectAst.where as { right?: { values?: unknown[] } })?.right;
    expect(whereRight?.values).toHaveLength(3);
  });

  it('transforms not in predicate', () => {
    const query = selectQueryFixture({
      where: {
        kind: 'WhereNode',
        node: {
          kind: 'BinaryOperationNode',
          left: {
            kind: 'ReferenceNode',
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'id' },
              table: { kind: 'IdentifierNode', name: 'user' },
            },
          },
          operator: { kind: 'OperatorNode', operator: 'not in' },
          right: {
            kind: 'PrimitiveValueListNode',
            values: [{ kind: 'ValueNode', value: 'a' }],
          },
        },
      },
    });
    const result = transformKyselyToPnAst(contract, query, ['a']);
    const selectAst = result.ast as SelectAst;
    expect(selectAst.where?.kind).toBe('bin');
    expect(selectAst.where).toMatchObject({
      kind: 'bin',
      op: 'notIn',
      left: { kind: 'col', table: 'user', column: 'id' },
      right: { kind: 'listLiteral', values: expect.any(Array) },
    });
  });

  it('transforms AND composition', () => {
    const query = selectQueryFixture({
      where: {
        kind: 'WhereNode',
        node: {
          kind: 'AndNode',
          exprs: [
            {
              kind: 'BinaryOperationNode',
              left: {
                kind: 'ReferenceNode',
                column: {
                  kind: 'ColumnNode',
                  column: { kind: 'IdentifierNode', name: 'id' },
                  table: { kind: 'IdentifierNode', name: 'user' },
                },
              },
              operator: { kind: 'OperatorNode', operator: '=' },
              right: { kind: 'ValueNode', value: 'x' },
            },
            {
              kind: 'BinaryOperationNode',
              left: {
                kind: 'ReferenceNode',
                column: {
                  kind: 'ColumnNode',
                  column: { kind: 'IdentifierNode', name: 'email' },
                  table: { kind: 'IdentifierNode', name: 'user' },
                },
              },
              operator: { kind: 'OperatorNode', operator: 'like' },
              right: { kind: 'ValueNode', value: '%@x.com' },
            },
          ],
        },
      },
    });
    const result = transformKyselyToPnAst(contract, query, ['x', '%@x.com']);
    const selectAst = result.ast as SelectAst;
    expect(selectAst.where?.kind).toBe('and');
    const andExprs = (selectAst.where as { exprs?: readonly unknown[] } | undefined)?.exprs;
    expect(andExprs).toHaveLength(2);
  });

  it('transforms join with ON', () => {
    const query = {
      kind: 'SelectQueryNode',
      from: {
        kind: 'FromNode',
        froms: [
          {
            kind: 'TableNode',
            table: { kind: 'IdentifierNode', name: 'user' },
          },
        ],
      },
      selections: [
        {
          kind: 'SelectAllNode',
          reference: { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } },
        },
      ],
      joins: [
        {
          kind: 'JoinNode',
          joinType: 'LeftJoinNode',
          table: {
            kind: 'TableNode',
            table: { kind: 'IdentifierNode', name: 'post' },
          },
          on: {
            kind: 'OnNode',
            node: {
              kind: 'BinaryOperationNode',
              left: {
                kind: 'ReferenceNode',
                column: {
                  kind: 'ColumnNode',
                  column: { kind: 'IdentifierNode', name: 'id' },
                  table: { kind: 'IdentifierNode', name: 'user' },
                },
              },
              operator: { kind: 'OperatorNode', operator: '=' },
              right: {
                kind: 'ReferenceNode',
                column: {
                  kind: 'ColumnNode',
                  column: { kind: 'IdentifierNode', name: 'userId' },
                  table: { kind: 'IdentifierNode', name: 'post' },
                },
              },
            },
          },
        },
      ],
    };
    const result = transformKyselyToPnAst(contract, query, []);
    const selectAst = result.ast as SelectAst;
    expect(selectAst.joins).toHaveLength(1);
    expect(selectAst.joins?.[0]).toMatchObject({
      kind: 'join',
      joinType: 'left',
      table: { kind: 'table', name: 'post' },
    });
    const firstJoin = selectAst.joins?.[0];
    expect(firstJoin).toBeDefined();
    expect(firstJoin!.on.kind).toBe('eqCol');
  });

  it('keeps explicit table refs when default table is provided', () => {
    const query = {
      kind: 'SelectQueryNode',
      from: {
        kind: 'FromNode',
        froms: [
          {
            kind: 'TableNode',
            table: { kind: 'IdentifierNode', name: 'user' },
          },
        ],
      },
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
      joins: [
        {
          kind: 'JoinNode',
          joinType: 'LeftJoinNode',
          table: {
            kind: 'TableNode',
            table: { kind: 'IdentifierNode', name: 'post' },
          },
          on: {
            kind: 'OnNode',
            node: {
              kind: 'BinaryOperationNode',
              left: {
                kind: 'ReferenceNode',
                column: {
                  kind: 'ColumnNode',
                  column: { kind: 'IdentifierNode', name: 'id' },
                  table: { kind: 'IdentifierNode', name: 'user' },
                },
              },
              operator: { kind: 'OperatorNode', operator: '=' },
              right: {
                kind: 'ReferenceNode',
                column: {
                  kind: 'ColumnNode',
                  column: { kind: 'IdentifierNode', name: 'userId' },
                  table: { kind: 'IdentifierNode', name: 'post' },
                },
              },
            },
          },
        },
      ],
      where: {
        kind: 'WhereNode',
        node: {
          kind: 'BinaryOperationNode',
          left: {
            kind: 'ReferenceNode',
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'userId' },
              table: { kind: 'IdentifierNode', name: 'post' },
            },
          },
          operator: { kind: 'OperatorNode', operator: '=' },
          right: { kind: 'ValueNode', value: 1 },
        },
      },
    };
    const result = transformKyselyToPnAst(contract, query, [1]);
    const selectAst = result.ast as SelectAst;
    expect(selectAst.where).toMatchObject({
      kind: 'bin',
      left: { kind: 'col', table: 'post', column: 'userId' },
    });
  });

  it('transforms orderBy', () => {
    const query = selectQueryFixture({
      orderBy: {
        kind: 'OrderByNode',
        items: [
          {
            kind: 'OrderByItemNode',
            orderBy: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'email' },
                table: { kind: 'IdentifierNode', name: 'user' },
              },
            },
            direction: 'asc',
          },
        ],
      },
    });
    const result = transformKyselyToPnAst(contract, query, []);
    const selectWithOrder = result.ast as SelectAst;
    expect(selectWithOrder.orderBy).toHaveLength(1);
    expect(selectWithOrder.orderBy?.[0]).toMatchObject({
      expr: { kind: 'col', table: 'user', column: 'email' },
      dir: 'asc',
    });
  });
});
