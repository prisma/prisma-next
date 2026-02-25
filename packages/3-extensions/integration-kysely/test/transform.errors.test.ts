import {
  KYSELY_TRANSFORM_ERROR_CODES,
  KyselyTransformError,
  transformKyselyToPnAst,
} from '@prisma-next/sql-kysely-lane';
import { describe, expect, it } from 'vitest';
import { contract, selectQueryFixture } from './transform.fixtures';

describe('transformKyselyToPnAst — unsupported nodes', () => {
  it('throws on unknown query kind', () => {
    expect(() => transformKyselyToPnAst(contract, { kind: 'UnknownNode' }, [])).toThrow(
      KyselyTransformError,
    );
    try {
      transformKyselyToPnAst(contract, { kind: 'UnknownNode' }, []);
    } catch (e) {
      expect(KyselyTransformError.is(e)).toBe(true);
      expect((e as KyselyTransformError).code).toBe(KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE);
    }
  });

  it('throws on SubQueryNode as root', () => {
    expect(() => transformKyselyToPnAst(contract, { kind: 'SubQueryNode', query: {} }, [])).toThrow(
      KyselyTransformError,
    );
    try {
      transformKyselyToPnAst(contract, { kind: 'SubQueryNode', query: {} }, []);
    } catch (e) {
      expect((e as KyselyTransformError).code).toBe(KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE);
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
      expect((e as KyselyTransformError).code).toBe(KYSELY_TRANSFORM_ERROR_CODES.UNSUPPORTED_NODE);
    }
  });
});

describe('transformKyselyToPnAst — defensive throws on ambiguous/invalid shapes', () => {
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

describe('transformKyselyToPnAst — contract validation', () => {
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
