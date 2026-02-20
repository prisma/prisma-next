import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { BinaryExpr, LiteralExpr } from '@prisma-next/sql-relational-core/ast';
import type { ComparisonMethods } from './types';

const OPS: ReadonlyArray<keyof ComparisonMethods<unknown>> = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
];

type SupportedComparisonOp = (typeof OPS)[number];

/**
 * Creates a Proxy-based column accessor for use inside `where()` callbacks.
 *
 * Accessing a field name returns an object with comparison methods (eq, neq, etc.)
 * that produce WhereExpr values. Field names are resolved to storage column names
 * via the contract's `mappings.fieldToColumn`.
 */
export function createColumnAccessor<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
>(contract: TContract, modelName: ModelName): Record<string, ComparisonMethods<unknown>> {
  const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};
  const tableName =
    contract.mappings.modelToTable?.[modelName] ??
    contract.models?.[modelName]?.storage?.table ??
    modelName;

  return new Proxy({} as Record<string, ComparisonMethods<unknown>>, {
    get(_target, prop: string | symbol): ComparisonMethods<unknown> | undefined {
      if (typeof prop !== 'string') {
        return undefined;
      }
      const columnName = fieldToColumn[prop] ?? prop;

      const methods: Record<string, (value: unknown) => BinaryExpr> = {};
      for (const op of OPS) {
        methods[op] = (value: unknown): BinaryExpr => {
          const literal: LiteralExpr = {
            kind: 'literal',
            value,
          };
          return {
            kind: 'bin',
            op: op as SupportedComparisonOp,
            left: {
              kind: 'col',
              table: tableName,
              column: columnName,
            },
            right: literal,
          };
        };
      }
      return methods as ComparisonMethods<unknown>;
    },
  });
}
