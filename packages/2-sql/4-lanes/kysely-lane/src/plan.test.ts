import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CompiledQuery } from 'kysely';
import { describe, expect, it } from 'vitest';
import { buildKyselyPlan } from './plan';

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
      },
      post: {
        columns: {
          id: { codecId: 'string', nativeType: 'uuid', nullable: false },
          userId: { codecId: 'string', nativeType: 'uuid', nullable: false },
        },
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
          operator: { kind: 'OperatorNode', operator: '=' },
          right: { kind: 'ValueNode', value: 'u1' },
        },
      },
    },
    queryId: {} as never,
    sql: 'select "id", "id", "email" from "user" where "id" = $1',
    parameters: ['u1'],
  };
}

describe('buildKyselyPlan', () => {
  it('assembles plan metadata with stable refs', () => {
    const plan = buildKyselyPlan(contract, createSelectCompiledQuery());

    expect(plan.params).toEqual(['u1']);
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
        selections: [
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
          {
            kind: 'SelectionNode',
            selection: {
              kind: 'ReferenceNode',
              column: {
                kind: 'ColumnNode',
                column: { kind: 'IdentifierNode', name: 'id' },
                table: { kind: 'IdentifierNode', name: 'post' },
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
        { table: 'post', column: 'userId' },
        { table: 'user', column: 'email' },
        { table: 'user', column: 'id' },
      ],
    });
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

  it('fails when descriptors and compiled parameters are misaligned', () => {
    const query = createSelectCompiledQuery();
    query.parameters = ['u1', 'u2'];
    expect(() => buildKyselyPlan(contract, query)).toThrow(/must match paramDescriptors length/i);
  });
});
