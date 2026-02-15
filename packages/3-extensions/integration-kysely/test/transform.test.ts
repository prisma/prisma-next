import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import type { PostgresContract } from '@prisma-next/adapter-postgres/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type {
  DeleteAst,
  InsertAst,
  SelectAst,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { Kysely, PostgresDialect } from 'kysely';
import { describe, expect, it } from 'vitest';
import { KYSELY_TRANSFORM_ERROR_CODES, KyselyTransformError } from '../src/transform/errors';
import { transformKyselyToPnAst } from '../src/transform/transform';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const contract = validateContract<Contract>(contractJson);
const adapter = createPostgresAdapter();
const postgresContract = contract as unknown as PostgresContract;

interface TestDb {
  user: {
    id: string;
    email: string;
    createdAt: string;
  };
}

function selectQueryFixture(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function binaryWhere(_id: string, value: unknown) {
  return {
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
      operator: { kind: 'OperatorNode', operator: '=' },
      right: { kind: 'ValueNode', value },
    },
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

describe('transformKyselyToPnAst', () => {
  describe('SelectQueryNode', () => {
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

  describe('InsertQueryNode', () => {
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
        expect((e as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
        );
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

  describe('UpdateQueryNode', () => {
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

  describe('DeleteQueryNode', () => {
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

  describe('unsupported nodes', () => {
    it('throws on unknown query kind', () => {
      expect(() => transformKyselyToPnAst(contract, { kind: 'UnknownNode' }, [])).toThrow(
        KyselyTransformError,
      );
      try {
        transformKyselyToPnAst(contract, { kind: 'UnknownNode' }, []);
      } catch (e) {
        expect(KyselyTransformError.is(e)).toBe(true);
        expect((e as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
        );
      }
    });

    it('throws on SubQueryNode as root', () => {
      expect(() =>
        transformKyselyToPnAst(contract, { kind: 'SubQueryNode', query: {} }, []),
      ).toThrow(KyselyTransformError);
      try {
        transformKyselyToPnAst(contract, { kind: 'SubQueryNode', query: {} }, []);
      } catch (e) {
        expect((e as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
        );
      }
    });

    it('throws on non-string operator payload', () => {
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
            operator: { kind: 'OperatorNode', operator: { value: '=' } },
            right: { kind: 'ValueNode', value: 'x' },
          },
        },
      });
      expect(() => transformKyselyToPnAst(contract, query, ['x'])).toThrow(KyselyTransformError);
      try {
        transformKyselyToPnAst(contract, query, ['x']);
      } catch (e) {
        expect((e as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE,
        );
      }
    });
  });

  describe('defensive throws on ambiguous/invalid shapes', () => {
    it('throws on unqualified column ref in multi-table scope', () => {
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
      };

      expect(() => transformKyselyToPnAst(contract, query, [])).toThrow(KyselyTransformError);
      try {
        transformKyselyToPnAst(contract, query, []);
      } catch (e) {
        expect((e as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.UNQUALIFIED_REF_IN_MULTI_TABLE,
        );
      }
    });

    it('throws on ambiguous selectAll in multi-table scope', () => {
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
        selections: [{ kind: 'SelectAllNode' }],
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

      expect(() => transformKyselyToPnAst(contract, query, [])).toThrow(KyselyTransformError);
      try {
        transformKyselyToPnAst(contract, query, []);
      } catch (e) {
        expect((e as KyselyTransformError).code).toBe(
          KYSELY_TRANSFORM_ERROR_CODES.AMBIGUOUS_SELECT_ALL,
        );
      }
    });
  });

  describe('paramDescriptors', () => {
    it('includes codecId and nativeType when contract has column metadata', () => {
      const query = selectQueryFixture({
        where: binaryWhere('id', 'uid'),
      });
      const result = transformKyselyToPnAst(contract, query, ['uid']);
      const desc = result.metaAdditions.paramDescriptors[0];
      expect(desc).toBeDefined();
      expect(desc?.refs).toEqual({ table: 'user', column: 'id' });
      expect(desc?.codecId).toBeDefined();
      expect(desc?.nativeType).toBeDefined();
    });
  });

  describe('param indexing', () => {
    it('aligns param indices with compiledQuery.parameters order', () => {
      const query = selectQueryFixture({
        where: binaryWhere('id', 'placeholder'),
        limit: {
          kind: 'LimitNode',
          limit: { kind: 'ValueNode', value: 'limit_placeholder' },
        },
      });
      const params = ['user_1', 5];
      const result = transformKyselyToPnAst(contract, query, params);
      expect(result.metaAdditions.paramDescriptors).toHaveLength(2);
      expect(result.metaAdditions.paramDescriptors[0]).toMatchObject({
        index: 1,
        source: 'lane',
        refs: { table: 'user', column: 'id' },
      });
      expect(result.metaAdditions.paramDescriptors[1]).toMatchObject({
        index: 2,
        source: 'lane',
      });
    });

    it('keeps descriptor order aligned with multiple where values', () => {
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
                right: { kind: 'ValueNode', value: 'first' },
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
                right: { kind: 'ValueNode', value: 'second' },
              },
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
                operator: { kind: 'OperatorNode', operator: 'in' },
                right: {
                  kind: 'PrimitiveValueListNode',
                  values: [
                    { kind: 'ValueNode', value: 'third' },
                    { kind: 'ValueNode', value: 'fourth' },
                  ],
                },
              },
            ],
          },
        },
      });

      const params = ['first', 'second', 'third', 'fourth'];
      const result = transformKyselyToPnAst(contract, query, params);
      expect(result.metaAdditions.paramDescriptors).toHaveLength(4);
      expect(result.metaAdditions.paramDescriptors.map((p) => p.index)).toEqual([1, 2, 3, 4]);
      expect(result.metaAdditions.paramDescriptors.map((p) => p.source)).toEqual([
        'lane',
        'lane',
        'lane',
        'lane',
      ]);
      expect(result.metaAdditions.paramDescriptors.map((p) => p.refs)).toEqual([
        { table: 'user', column: 'id' },
        { table: 'user', column: 'email' },
        { table: 'user', column: 'id' },
        { table: 'user', column: 'id' },
      ]);
    });
  });

  describe('lowering parity', () => {
    it('matches Kysely compiled SQL for simple insert', async () => {
      const db = new Kysely<TestDb>({
        dialect: new PostgresDialect({ pool: {} as never }),
      });

      try {
        const compiled = db
          .insertInto('user')
          .values({ id: 'u_1', email: 'u_1@example.com', createdAt: '2024-01-01' })
          .compile();
        const transformed = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
        const lowered = adapter.lower(transformed.ast, {
          contract: postgresContract,
          params: compiled.parameters,
        });

        expect(normalizeSql(lowered.body.sql)).toBe(normalizeSql(compiled.sql));
        expect(lowered.body.params).toEqual(compiled.parameters);
      } finally {
        await db.destroy();
      }
    });

    it('keeps select semantics aligned with Kysely compiled output', async () => {
      const db = new Kysely<TestDb>({
        dialect: new PostgresDialect({ pool: {} as never }),
      });

      try {
        const compiled = db
          .selectFrom('user')
          .select(['id', 'email'])
          .where('id', '=', 'u_1')
          .orderBy('email', 'asc')
          .compile();
        const transformed = transformKyselyToPnAst(contract, compiled.query, compiled.parameters);
        const lowered = adapter.lower(transformed.ast, {
          contract: postgresContract,
          params: compiled.parameters,
        });

        const loweredSql = normalizeSql(lowered.body.sql);
        const compiledSql = normalizeSql(compiled.sql);

        expect(loweredSql).toContain('from "user"');
        expect(compiledSql).toContain('from "user"');
        expect(loweredSql).toContain('where "user"."id" = $1');
        expect(compiledSql).toContain('where "id" = $1');
        expect(loweredSql).toContain('order by');
        expect(compiledSql).toContain('order by');
        expect(lowered.body.params).toEqual(compiled.parameters);
      } finally {
        await db.destroy();
      }
    });
  });

  describe('ref extraction', () => {
    it('populates meta.refs.tables and meta.refs.columns', () => {
      const result = transformKyselyToPnAst(
        contract,
        selectQueryFixture({ where: binaryWhere('id', 1) }),
        [1],
      );
      expect(result.metaAdditions.refs.tables).toContain('user');
      expect(result.metaAdditions.refs.columns).toContainEqual({
        table: 'user',
        column: 'id',
      });
    });
  });

  describe('contract validation', () => {
    it('throws on unknown table', () => {
      const query = selectQueryFixture();
      const badQuery = {
        ...query,
        from: {
          kind: 'FromNode',
          froms: [
            {
              kind: 'TableNode',
              table: { kind: 'IdentifierNode', name: 'nonexistent_table' },
            },
          ],
        },
      };
      expect(() => transformKyselyToPnAst(contract, badQuery, [])).toThrow(KyselyTransformError);
      try {
        transformKyselyToPnAst(contract, badQuery, []);
      } catch (e) {
        expect((e as KyselyTransformError).code).toBe(KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF);
        expect((e as KyselyTransformError).details?.table).toBe('nonexistent_table');
      }
    });

    it('throws on unknown column in where', () => {
      const query = selectQueryFixture({
        where: {
          kind: 'WhereNode',
          node: {
            kind: 'BinaryOperationNode',
            left: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'nonexistent_col' },
                table: { kind: 'IdentifierNode', name: 'user' },
              },
            },
            operator: { kind: 'OperatorNode', operator: '=' },
            right: { kind: 'ValueNode', value: 'x' },
          },
        },
      });
      expect(() => transformKyselyToPnAst(contract, query, ['x'])).toThrow(KyselyTransformError);
      try {
        transformKyselyToPnAst(contract, query, ['x']);
      } catch (e) {
        expect((e as KyselyTransformError).code).toBe(KYSELY_TRANSFORM_ERROR_CODES.INVALID_REF);
      }
    });
  });
});
