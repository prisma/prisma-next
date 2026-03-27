import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { ShorthandWhereFilter } from './types';

export function and(...exprs: AnyExpression[]): AndExpr {
  return AndExpr.of(exprs);
}

export function or(...exprs: AnyExpression[]): OrExpr {
  return OrExpr.of(exprs);
}

export function not(expr: AnyExpression): AnyExpression {
  return expr.not();
}

export function all(): AnyExpression {
  return AndExpr.true();
}

export function shorthandToWhereExpr<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
>(
  context: ExecutionContext<TContract>,
  modelName: ModelName,
  filters: ShorthandWhereFilter<TContract, ModelName>,
): AnyExpression | undefined {
  const contract = context.contract;
  const models = contract.models as Record<
    string,
    {
      storage?: {
        table?: string;
      };
    }
  >;
  const tableName =
    contract.mappings.modelToTable?.[modelName] ?? models[modelName]?.storage?.table ?? modelName;
  const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};

  const exprs: AnyExpression[] = [];
  for (const [fieldName, value] of Object.entries(filters)) {
    if (value === undefined) {
      continue;
    }

    const columnName = fieldToColumn[fieldName] ?? fieldName;
    const left = ColumnRef.of(tableName, columnName);

    if (value === null) {
      exprs.push(NullCheckExpr.isNull(left));
      continue;
    }

    assertFieldHasEqualityTrait(context, tableName, columnName, modelName, fieldName);
    exprs.push(BinaryExpr.eq(left, LiteralExpr.of(value)));
  }

  if (exprs.length === 0) {
    return undefined;
  }

  return exprs.length === 1 ? exprs[0] : and(...exprs);
}

function assertFieldHasEqualityTrait(
  context: ExecutionContext,
  tableName: string,
  columnName: string,
  modelName: string,
  fieldName: string,
): void {
  const tables = context.contract.storage?.tables as
    | Record<string, { columns?: Record<string, { codecId?: string }> }>
    | undefined;
  const codecId = tables?.[tableName]?.columns?.[columnName]?.codecId;
  const traits = codecId ? context.codecs.traitsOf(codecId) : [];
  if (!traits.includes('equality')) {
    throw new Error(
      `Shorthand filter on "${modelName}.${fieldName}": field does not support equality comparisons`,
    );
  }
}
