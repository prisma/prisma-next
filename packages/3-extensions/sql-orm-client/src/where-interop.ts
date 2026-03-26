import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ToWhereExpr, WhereArg, WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { bindWhereExpr } from './where-binding';

interface NormalizeWhereArgOptions {
  readonly contract?: SqlContract<SqlStorage>;
}

export function normalizeWhereArg(arg: undefined): undefined;
export function normalizeWhereArg(arg: undefined, options: NormalizeWhereArgOptions): undefined;
export function normalizeWhereArg(arg: WhereArg, options?: NormalizeWhereArgOptions): WhereExpr;
export function normalizeWhereArg(
  arg: WhereArg | undefined,
  options?: NormalizeWhereArgOptions,
): WhereExpr | undefined;
export function normalizeWhereArg(
  arg: WhereArg | undefined,
  options?: NormalizeWhereArgOptions,
): WhereExpr | undefined {
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

  if (options?.contract) {
    return bindWhereExpr(options.contract, arg);
  }
  return arg;
}

function isToWhereExpr(arg: WhereArg): arg is ToWhereExpr {
  return typeof arg === 'object' && arg !== null && 'toWhereExpr' in arg;
}
