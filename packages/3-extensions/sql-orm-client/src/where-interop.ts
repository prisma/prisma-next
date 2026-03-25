import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  AnyWhereExpr,
  BoundWhereExpr,
  ToWhereExpr,
  WhereArg,
} from '@prisma-next/sql-relational-core/ast';
import { bindWhereExpr } from './where-binding';

interface NormalizeWhereArgOptions {
  readonly contract?: SqlContract<SqlStorage>;
}

export function normalizeWhereArg(arg: undefined): undefined;
export function normalizeWhereArg(arg: undefined, options: NormalizeWhereArgOptions): undefined;
export function normalizeWhereArg(
  arg: WhereArg,
  options?: NormalizeWhereArgOptions,
): BoundWhereExpr;
export function normalizeWhereArg(
  arg: WhereArg | undefined,
  options?: NormalizeWhereArgOptions,
): BoundWhereExpr | undefined;
export function normalizeWhereArg(
  arg: WhereArg | undefined,
  options?: NormalizeWhereArgOptions,
): BoundWhereExpr | undefined {
  if (arg === undefined) {
    return undefined;
  }
  if (arg === null) {
    throw new Error(
      'WhereArg cannot be null. Pass undefined or a valid WhereExpr/ToWhereExpr payload.',
    );
  }

  if (isToWhereExpr(arg)) {
    const bound = arg.toWhereExpr();
    return { expr: bound.expr };
  }

  if (options?.contract) {
    return bindWhereExpr(options.contract, arg);
  }
  return { expr: arg };
}

function isToWhereExpr(arg: WhereArg): arg is ToWhereExpr {
  return typeof arg === 'object' && arg !== null && 'toWhereExpr' in arg;
}
