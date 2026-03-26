import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { SelectAst, type ToWhereExpr, type WhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { CompiledQuery } from 'kysely';
import type { BuildKyselyPlanOptions } from './plan';
import { buildKyselyPlan } from './plan';

class LaneWhereExpr implements ToWhereExpr {
  readonly #expr: WhereExpr;

  constructor(expr: WhereExpr) {
    this.#expr = expr;
  }

  toWhereExpr(): WhereExpr {
    return this.#expr;
  }
}

export function buildKyselyWhereExpr<Row>(
  contract: SqlContract<SqlStorage>,
  compiledQuery: CompiledQuery<Row>,
  options: BuildKyselyPlanOptions = {},
): ToWhereExpr {
  const plan = buildKyselyPlan(contract, compiledQuery, options);
  if (!(plan.ast instanceof SelectAst) || !plan.ast.where) {
    throw new Error('whereExpr(...) requires a select query with a where clause');
  }

  return new LaneWhereExpr(plan.ast.where);
}
