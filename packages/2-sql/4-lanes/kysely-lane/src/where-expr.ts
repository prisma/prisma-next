import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { AnyExpression, ToWhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { CompiledQuery } from 'kysely';
import type { BuildKyselyPlanOptions } from './plan';
import { buildKyselyPlan } from './plan';

class LaneWhereExpr implements ToWhereExpr {
  readonly #expr: AnyExpression;

  constructor(expr: AnyExpression) {
    this.#expr = expr;
  }

  toWhereExpr(): AnyExpression {
    return this.#expr;
  }
}

export function buildKyselyWhereExpr<Row>(
  contract: SqlContract<SqlStorage>,
  compiledQuery: CompiledQuery<Row>,
  options: BuildKyselyPlanOptions = {},
): ToWhereExpr {
  const plan = buildKyselyPlan(contract, compiledQuery, options);
  if (plan.ast.kind !== 'select' || !plan.ast.where) {
    throw new Error('whereExpr(...) requires a select query with a where clause');
  }

  return new LaneWhereExpr(plan.ast.where);
}
