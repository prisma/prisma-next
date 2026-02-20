import type { AndExpr, BinaryExpr, OrExpr, WhereExpr } from '@prisma-next/sql-relational-core/ast';

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
