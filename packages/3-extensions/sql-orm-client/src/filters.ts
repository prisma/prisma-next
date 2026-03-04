import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { AndExpr, BinaryExpr, OrExpr, WhereExpr } from '@prisma-next/sql-relational-core/ast';
import {
  createAndExpr,
  createBinaryExpr,
  createColumnRef,
  createLiteralExpr,
  createNullCheckExpr,
  createOrExpr,
  createTrueExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { ShorthandWhereFilter } from './types';

export function and(...exprs: WhereExpr[]): AndExpr {
  return createAndExpr(exprs);
}

export function or(...exprs: WhereExpr[]): OrExpr {
  return createOrExpr(exprs);
}

export function not(expr: WhereExpr): WhereExpr {
  switch (expr.kind) {
    case 'bin':
      return negateBinary(expr);
    case 'and':
      return createOrExpr(expr.exprs.map(not));
    case 'or':
      return createAndExpr(expr.exprs.map(not));
    case 'exists':
      return {
        ...expr,
        not: !expr.not,
      };
    case 'nullCheck':
      return {
        ...expr,
        isNull: !expr.isNull,
      };
    default: {
      const neverExpr: never = expr;
      throw new Error(`Unsupported where expression kind for not(): ${String(neverExpr)}`);
    }
  }
}

export function all(): WhereExpr {
  return createTrueExpr();
}

export function shorthandToWhereExpr<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
>(
  contract: TContract,
  modelName: ModelName,
  filters: ShorthandWhereFilter<TContract, ModelName>,
): WhereExpr | undefined {
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

  const exprs: WhereExpr[] = [];
  for (const [fieldName, value] of Object.entries(filters)) {
    if (value === undefined) {
      continue;
    }

    const columnName = fieldToColumn[fieldName] ?? fieldName;
    const left = createColumnRef(tableName, columnName);

    if (value === null) {
      exprs.push(createNullCheckExpr(left, true));
      continue;
    }

    exprs.push(createBinaryExpr('eq', left, createLiteralExpr(value)));
  }

  if (exprs.length === 0) {
    return undefined;
  }

  return exprs.length === 1 ? exprs[0] : and(...exprs);
}

function negateBinary(expr: BinaryExpr): BinaryExpr {
  return {
    ...expr,
    op: negateBinaryOp(expr.op),
  };
}

function negateBinaryOp(op: BinaryExpr['op']): BinaryExpr['op'] {
  switch (op) {
    case 'eq':
      return 'neq';
    case 'neq':
      return 'eq';
    case 'gt':
      return 'lte';
    case 'lt':
      return 'gte';
    case 'gte':
      return 'lt';
    case 'lte':
      return 'gt';
    case 'in':
      return 'notIn';
    case 'notIn':
      return 'in';
    case 'like':
    case 'ilike':
      throw new Error(`Operator "${op}" is not negatable without explicit NOT support in the AST`);
    default: {
      const neverOp: never = op;
      throw new Error(`Unknown binary operator: ${String(neverOp)}`);
    }
  }
}
