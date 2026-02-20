import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  OrExpr,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { ShorthandWhereFilter } from './types';

export function and(...exprs: WhereExpr[]): AndExpr {
  return {
    kind: 'and',
    exprs,
  };
}

export function or(...exprs: WhereExpr[]): OrExpr {
  return {
    kind: 'or',
    exprs,
  };
}

export function not(expr: WhereExpr): WhereExpr {
  switch (expr.kind) {
    case 'bin':
      return negateBinary(expr);
    case 'and':
      return {
        kind: 'or',
        exprs: expr.exprs.map(not),
      };
    case 'or':
      return {
        kind: 'and',
        exprs: expr.exprs.map(not),
      };
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
  return {
    kind: 'and',
    exprs: [],
  };
}

export function shorthandToWhereExpr<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
>(
  contract: TContract,
  modelName: ModelName,
  filters: ShorthandWhereFilter<TContract, ModelName>,
): WhereExpr | undefined {
  const tableName =
    contract.mappings.modelToTable?.[modelName] ??
    contract.models?.[modelName]?.storage?.table ??
    modelName;
  const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};

  const exprs: WhereExpr[] = [];
  for (const [fieldName, value] of Object.entries(filters)) {
    if (value === undefined) {
      continue;
    }

    const columnName = fieldToColumn[fieldName] ?? fieldName;
    const left: ColumnRef = {
      kind: 'col',
      table: tableName,
      column: columnName,
    };

    if (value === null) {
      exprs.push({
        kind: 'nullCheck',
        expr: left,
        isNull: true,
      });
      continue;
    }

    const right: LiteralExpr = {
      kind: 'literal',
      value,
    };
    exprs.push({
      kind: 'bin',
      op: 'eq',
      left,
      right,
    });
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
