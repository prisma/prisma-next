import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
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
import { getFieldToColumnMap, modelOf, resolveModelTableName } from './collection-contract';
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
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
>(
  context: ExecutionContext<TContract>,
  modelName: ModelName,
  filters: ShorthandWhereFilter<TContract, ModelName>,
): AnyExpression | undefined {
  const contract = context.contract;
  const tableName = resolveModelTableName(contract, modelName);
  const fieldToColumn = getFieldToColumnMap(contract, modelName);

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

    assertFieldHasEqualityTrait(context, modelName, fieldName);
    exprs.push(BinaryExpr.eq(left, LiteralExpr.of(value)));
  }

  if (exprs.length === 0) {
    return undefined;
  }

  return exprs.length === 1 ? exprs[0] : and(...exprs);
}

function assertFieldHasEqualityTrait(
  context: ExecutionContext,
  modelName: string,
  fieldName: string,
): void {
  const codecId = modelOf(context.contract, modelName)?.fields?.[fieldName]?.codecId;
  const traits = codecId ? context.codecs.traitsOf(codecId) : [];
  if (!traits.includes('equality')) {
    throw new Error(
      `Shorthand filter on "${modelName}.${fieldName}": field does not support equality comparisons`,
    );
  }
}
