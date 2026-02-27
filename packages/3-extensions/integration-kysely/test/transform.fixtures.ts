import type { PostgresContract } from '@prisma-next/adapter-postgres/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { type CompiledQuery, Kysely, PostgresDialect } from 'kysely';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

export const contract = validateContract<Contract>(contractJson);
export const postgresContract = contract as unknown as PostgresContract;

export interface TestDb {
  user: {
    id: string;
    email: string;
    createdAt: string;
  };
  post: {
    id: string;
    userId: string;
    title: string;
    createdAt: string;
    embedding: number[] | null;
  };
}

export const compilerDb = new Kysely<TestDb>({
  dialect: new PostgresDialect({ pool: {} as unknown as import('pg').Pool }),
});

export interface CompilableQuery<Row = unknown> {
  compile(): CompiledQuery<Row>;
}

export function compileQuery<Row>(queryBuilder: CompilableQuery<Row>): CompiledQuery<Row> {
  return queryBuilder.compile();
}

export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

type SelectFixtureOverrides = Partial<{
  from: unknown;
  selections: unknown;
  where: unknown;
  joins: unknown;
  orderBy: unknown;
  limit: unknown;
}>;

export function binaryWhere(
  column: string,
  value: unknown,
  table = 'user',
): Record<string, unknown> {
  return {
    kind: 'WhereNode',
    node: {
      kind: 'BinaryOperationNode',
      left: {
        kind: 'ReferenceNode',
        column: {
          kind: 'ColumnNode',
          column: { kind: 'IdentifierNode', name: column },
          table: { kind: 'IdentifierNode', name: table },
        },
      },
      operator: { kind: 'OperatorNode', operator: '=' },
      right: { kind: 'ValueNode', value },
    },
  };
}

export function selectQueryFixture(
  overrides: SelectFixtureOverrides = {},
): Record<string, unknown> {
  return {
    kind: 'SelectQueryNode',
    from: {
      kind: 'FromNode',
      froms: [{ kind: 'TableNode', table: { kind: 'IdentifierNode', name: 'user' } }],
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
            column: { kind: 'IdentifierNode', name: 'createdAt' },
            table: { kind: 'IdentifierNode', name: 'user' },
          },
        },
      },
    ],
    ...overrides,
  };
}
