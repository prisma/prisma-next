import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { WhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { ComparisonMethods } from './types';

const OPS: ReadonlyArray<keyof ComparisonMethods<unknown>> = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
];

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

  return new Proxy({} as Record<string, ComparisonMethods<unknown>>, {
    get(_target, prop: string | symbol): ComparisonMethods<unknown> | undefined {
      if (typeof prop !== 'string') {
        return undefined;
      }
      const columnName = fieldToColumn[prop] ?? prop;

      const methods: Record<string, (value: unknown) => WhereExpr> = {};
      for (const op of OPS) {
        methods[op] = (value: unknown): WhereExpr =>
          ({
            column: columnName,
            op,
            value,
          }) as unknown as WhereExpr;
      }
      return methods as ComparisonMethods<unknown>;
    },
  });
}
