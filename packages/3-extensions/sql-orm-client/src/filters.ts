import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AndExpr,
  type AnyWhereExpr,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  NullCheckExpr,
  OrExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { ShorthandWhereFilter } from './types';

export function and(...exprs: AnyWhereExpr[]): AndExpr {
  return AndExpr.of(exprs);
}

export function or(...exprs: AnyWhereExpr[]): OrExpr {
  return OrExpr.of(exprs);
}

export function not(expr: AnyWhereExpr): AnyWhereExpr {
  return expr.not();
}

export function all(): AnyWhereExpr {
  return AndExpr.true();
}

export function shorthandToWhereExpr<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
>(
  contract: TContract,
  modelName: ModelName,
  filters: ShorthandWhereFilter<TContract, ModelName>,
): AnyWhereExpr | undefined {
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

  const exprs: AnyWhereExpr[] = [];
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

    exprs.push(BinaryExpr.eq(left, LiteralExpr.of(value)));
  }

  if (exprs.length === 0) {
    return undefined;
  }

  return exprs.length === 1 ? exprs[0] : and(...exprs);
}
