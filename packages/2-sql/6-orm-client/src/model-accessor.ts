import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { BinaryExpr, ColumnRef, LiteralExpr } from '@prisma-next/sql-relational-core/ast';
import type { ComparisonMethods } from './types';

const COMPARISON_OPS: ReadonlyArray<BinaryExpr['op']> = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'like',
  'ilike',
  'in',
  'notIn',
];

/**
 * Creates a Proxy-based column accessor for use inside `where()` callbacks.
 *
 * Accessing a field name returns an object with comparison methods (eq, neq, etc.)
 * that produce WhereExpr values. Field names are resolved to storage column names
 * via the contract's `mappings.fieldToColumn`.
 */
export function createModelAccessor<
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
      const left: ColumnRef = {
        kind: 'col',
        table: tableName,
        column: columnName,
      };

      const methods: Partial<ComparisonMethods<unknown>> = {};
      for (const op of COMPARISON_OPS) {
        if (op === 'in' || op === 'notIn') {
          methods[op] = ((values: readonly unknown[]): BinaryExpr => ({
            kind: 'bin',
            op,
            left,
            right: {
              kind: 'listLiteral',
              values: values.map(
                (value): LiteralExpr => ({
                  kind: 'literal',
                  value,
                }),
              ),
            },
          })) as ComparisonMethods<unknown>[typeof op];
          continue;
        }

        methods[op] = ((value: unknown): BinaryExpr => ({
          kind: 'bin',
          op,
          left,
          right: {
            kind: 'literal',
            value,
          },
        })) as ComparisonMethods<unknown>[typeof op];
      }

      methods.isNull = () => ({
        kind: 'nullCheck',
        expr: left,
        isNull: true,
      });
      methods.isNotNull = () => ({
        kind: 'nullCheck',
        expr: left,
        isNull: false,
      });
      methods.asc = () => ({
        column: columnName,
        direction: 'asc',
      });
      methods.desc = () => ({
        column: columnName,
        direction: 'desc',
      });

      return methods as ComparisonMethods<unknown>;
    },
  });
}
