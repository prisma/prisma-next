import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CompiledQuery } from 'kysely';
import { describe, expect, it } from 'vitest';
import { buildKyselyWhereExpr } from './where-expr';

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
          kind: { codecId: 'string', nativeType: 'text', nullable: false },
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

function createSelectWithWhereCompiledQuery(): CompiledQuery<{ id: string }> {
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
              column: { kind: 'IdentifierNode', name: 'kind' },
            },
          },
          operator: { kind: 'OperatorNode', operator: '=' },
          rightOperand: { kind: 'ValueNode', value: 'admin' },
        },
      },
    },
    queryId: {} as never,
    sql: 'select "id" from "user" where "kind" = $1',
    parameters: ['admin'],
  } as unknown as CompiledQuery<{ id: string }>;
}

function createSelectWithoutWhereCompiledQuery(): CompiledQuery<{ id: string }> {
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
      ],
    },
    queryId: {} as never,
    sql: 'select "id" from "user"',
    parameters: [],
  } as unknown as CompiledQuery<{ id: string }>;
}

describe('buildKyselyWhereExpr', () => {
  it('returns ToWhereExpr payload for select where filters', () => {
    const whereArg = buildKyselyWhereExpr(contract, createSelectWithWhereCompiledQuery());
    const bound = whereArg.toWhereExpr();
    expect(bound.params).toEqual(['admin']);
    expect(bound.paramDescriptors).toHaveLength(1);
    expect(bound.paramDescriptors[0]?.index).toBe(1);
    expect(bound.paramDescriptors[0]?.source).toBe('lane');
  });

  it('throws when select query has no where clause', () => {
    expect(() => buildKyselyWhereExpr(contract, createSelectWithoutWhereCompiledQuery())).toThrow(
      /requires a select query with a where clause/i,
    );
  });
});
