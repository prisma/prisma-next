import type { PostgresContract } from '@prisma-next/adapter-postgres/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
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
}

export function selectQueryFixture(overrides: Record<string, unknown> = {}) {
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

export function binaryWhere(_id: string, value: unknown) {
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

export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}
