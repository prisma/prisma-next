import type { AnyExpression, ToWhereExpr, WhereArg } from '@prisma-next/sql-relational-core/ast';
import { isWhereExpr } from '@prisma-next/sql-relational-core/ast';

export function normalizeWhereArg(arg: undefined): undefined;
export function normalizeWhereArg(arg: WhereArg): AnyExpression;
export function normalizeWhereArg(arg: WhereArg | undefined): AnyExpression | undefined;
export function normalizeWhereArg(arg: WhereArg | undefined): AnyExpression | undefined {
  if (arg === undefined) {
    return undefined;
  }
  if (arg === null) {
    throw new Error(
      'WhereArg cannot be null. Pass undefined or a valid WhereExpr/ToWhereExpr payload.',
    );
  }

  if (isToWhereExpr(arg)) {
    return arg.toWhereExpr();
  }

  return arg;
}

function isToWhereExpr(arg: WhereArg): arg is ToWhereExpr {
  return typeof arg === 'object' && arg !== null && 'toWhereExpr' in arg && !isWhereExpr(arg);
}
