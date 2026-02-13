import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ComparisonMethods, ComparisonOp, FilterExpr } from './types';

const OPS: readonly ComparisonOp[] = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte'];

/**
 * Creates a Proxy-based column accessor for use inside `where()` callbacks.
 *
 * Accessing a field name returns an object with comparison methods (eq, neq, etc.)
 * that produce FilterExpr values. Field names are resolved to storage column names
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

      const methods: Record<string, (value: unknown) => FilterExpr> = {};
      for (const op of OPS) {
        methods[op] = (value: unknown): FilterExpr => ({
          column: columnName,
          op,
          value,
        });
      }
      return methods as ComparisonMethods<unknown>;
    },
  });
}
