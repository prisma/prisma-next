import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CompiledQuery } from 'kysely';
import { describe, expect, it } from 'vitest';
import { buildKyselyPlan, REDACTED_SQL } from './plan';

const contract: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  storageHash: 'sha256:test' as never,
  models: {},
  relations: {},
  storage: {
    tables: {
      user: {
        columns: {
          id: { codecId: 'string', nativeType: 'uuid', nullable: false },
          email: { codecId: 'string', nativeType: 'text', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
      post: {
        columns: {
          id: { codecId: 'string', nativeType: 'uuid', nullable: false },
          userId: { codecId: 'string', nativeType: 'uuid', nullable: false },
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  extensionPacks: {},
  capabilities: {},
  meta: {},
  sources: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
};

function createSelectCompiledQuery(): CompiledQuery<{ id: string; email: string }> {
  return {
    query: {
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
            table: {
              kind: 'TableNode',
              table: { kind: 'IdentifierNode', name: 'user' },
            },
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'id' },
            },
          },
        },
        {
          kind: 'SelectionNode',
          selection: {
            kind: 'ReferenceNode',
            table: {
              kind: 'TableNode',
              table: { kind: 'IdentifierNode', name: 'user' },
            },
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'id' },
            },
          },
        },
        {
          kind: 'SelectionNode',
          selection: {
            kind: 'ReferenceNode',
            table: {
              kind: 'TableNode',
              table: { kind: 'IdentifierNode', name: 'user' },
            },
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'email' },
            },
          },
        },
      ],
      where: {
        kind: 'WhereNode',
        where: {
          kind: 'BinaryOperationNode',
          leftOperand: {
            kind: 'ReferenceNode',
            table: {
              kind: 'TableNode',
              table: { kind: 'IdentifierNode', name: 'user' },
            },
            column: {
              kind: 'ColumnNode',
              column: { kind: 'IdentifierNode', name: 'id' },
            },
          },
          operator: { kind: 'OperatorNode', operator: '=' },
          rightOperand: { kind: 'ValueNode', value: 'u1' },
        },
      },
    },
    queryId: {} as never,
    sql: 'select "id", "id", "email" from "user" where "id" = $1',
    parameters: ['u1'],
  } as unknown as CompiledQuery<{ id: string; email: string }>;
}

describe('buildKyselyPlan', () => {
  it('assembles plan metadata with stable refs', () => {
    const plan = buildKyselyPlan(contract, createSelectCompiledQuery());

    expect(plan.params).toEqual(['u1']);
    expect(plan.meta.annotations).toMatchObject({ sql: REDACTED_SQL });
    expect(plan.meta.refs).toEqual({
      tables: ['user'],
      columns: [
        { table: 'user', column: 'email' },
        { table: 'user', column: 'id' },
      ],
    });
  });

  it('emits deterministic refs for equivalent query shapes', () => {
    const first = buildKyselyPlan(contract, createSelectCompiledQuery());
    const second = buildKyselyPlan(contract, createSelectCompiledQuery());
    expect(first.meta.refs).toEqual(second.meta.refs);
  });

  it('canonicalizes refs ordering', () => {
    const query = {
      query: {
        kind: 'SelectQueryNode',
        from: {
          kind: 'FromNode',
          froms: [{ kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } }],
        },
        joins: [
          {
            kind: 'JoinNode',
            joinType: 'InnerJoinNode',
            table: { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'post' } },
            on: {
              kind: 'OnNode',
              on: {
                kind: 'BinaryOperationNode',
                leftOperand: {
                  kind: 'ReferenceNode',
                  table: {
                    kind: 'TableNode',
                    table: { kind: 'IdentifierNode', name: 'user' },
                  },
                  column: {
                    kind: 'ColumnNode',
                    column: { kind: 'IdentifierNode', name: 'id' },
                  },
                },
                operator: { kind: 'OperatorNode', operator: '=' },
                rightOperand: {
                  kind: 'ReferenceNode',
                  table: {
                    kind: 'TableNode',
                    table: { kind: 'IdentifierNode', name: 'post' },
                  },
                  column: {
                    kind: 'ColumnNode',
                    column: { kind: 'IdentifierNode', name: 'userId' },
                  },
                },
              },
            },
          },
        ],
        selections: [
          {
            kind: 'SelectionNode',
            selection: {
              kind: 'ReferenceNode',
              table: {
                kind: 'TableNode',
                table: { kind: 'IdentifierNode', name: 'user' },
              },
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'email' },
              },
            },
          },
          {
            kind: 'SelectionNode',
            selection: {
              kind: 'ReferenceNode',
              table: {
                kind: 'TableNode',
                table: { kind: 'IdentifierNode', name: 'post' },
              },
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'id' },
              },
            },
          },
        ],
      },
      queryId: {} as never,
      sql: 'select "user"."email","post"."id" from "user" join "post" on ...',
      parameters: [],
    } as unknown as CompiledQuery<unknown>;

    const plan = buildKyselyPlan(contract, query);
    expect(plan.meta.refs).toEqual({
      tables: ['post', 'user'],
      columns: [
        { table: 'post', column: 'id' },
        { table: 'post', column: 'userId' },
        { table: 'user', column: 'email' },
        { table: 'user', column: 'id' },
      ],
    });
  });

  it('emits join sources with lateral metadata', () => {
    const query = {
      query: {
        kind: 'SelectQueryNode',
        from: {
          kind: 'FromNode',
          froms: [{ kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } }],
        },
        joins: [
          {
            kind: 'JoinNode',
            joinType: 'LateralLeftJoinNode',
            table: { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'post' } },
            on: {
              kind: 'OnNode',
              on: {
                kind: 'BinaryOperationNode',
                leftOperand: {
                  kind: 'ReferenceNode',
                  table: {
                    kind: 'TableNode',
                    table: { kind: 'IdentifierNode', name: 'user' },
                  },
                  column: {
                    kind: 'ColumnNode',
                    column: { kind: 'IdentifierNode', name: 'id' },
                  },
                },
                operator: { kind: 'OperatorNode', operator: '=' },
                rightOperand: {
                  kind: 'ReferenceNode',
                  table: {
                    kind: 'TableNode',
                    table: { kind: 'IdentifierNode', name: 'post' },
                  },
                  column: {
                    kind: 'ColumnNode',
                    column: { kind: 'IdentifierNode', name: 'userId' },
                  },
                },
              },
            },
          },
        ],
        selections: [
          {
            kind: 'SelectionNode',
            selection: {
              kind: 'ReferenceNode',
              table: {
                kind: 'TableNode',
                table: { kind: 'IdentifierNode', name: 'user' },
              },
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'id' },
              },
            },
          },
        ],
      },
      queryId: {} as never,
      sql: 'select "user"."id" from "user" left join lateral "post" on ...',
      parameters: [],
    } as unknown as CompiledQuery<unknown>;

    const plan = buildKyselyPlan(contract, query);
    expect(plan.ast.kind).toBe('select');
    if (plan.ast.kind !== 'select') {
      throw new Error('expected select ast');
    }
    expect(plan.ast.joins).toEqual([
      expect.objectContaining({
        kind: 'join',
        joinType: 'left',
        lateral: true,
        source: { kind: 'table', name: 'post' },
      }),
    ]);
  });

  it('fails fast on unsupported query kinds', () => {
    const unsupported = {
      query: { kind: 'RawNode' },
      queryId: {} as never,
      sql: 'select now()',
      parameters: [],
    } as unknown as CompiledQuery<unknown>;

    expect(() => buildKyselyPlan(contract, unsupported)).toThrow(/Unsupported query kind: RawNode/);
  });

  it('rejects ambiguous selectAll in multi-table scope', () => {
    const query = {
      query: {
        kind: 'SelectQueryNode',
        from: {
          kind: 'FromNode',
          froms: [
            { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } },
            { kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'post' } },
          ],
        },
        selections: [{ kind: 'SelectAllNode' }],
      },
      queryId: {} as never,
      sql: 'select * from "user", "post"',
      parameters: [],
    } as unknown as CompiledQuery<unknown>;

    expect(() => buildKyselyPlan(contract, query)).toThrow(/Ambiguous selectAll/);
  });

  it('trims extra compiled parameters beyond descriptor count', () => {
    const query = {
      ...createSelectCompiledQuery(),
      parameters: ['u1', 'u2'],
    } as CompiledQuery<{ id: string; email: string }>;
    const plan = buildKyselyPlan(contract, query);
    expect(plan.params).toEqual(['u1']);
  });

  it('fails when compiled parameters are fewer than descriptors', () => {
    const query = {
      ...createSelectCompiledQuery(),
      parameters: [],
    } as CompiledQuery<{ id: string; email: string }>;

    expect(() => buildKyselyPlan(contract, query)).toThrow(/Kysely plan parameter mismatch/);
  });
});
