import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { BoundWhereExpr, ToWhereExpr } from '@prisma-next/sql-relational-core/ast';
import type { CompiledQuery } from 'kysely';
import type { BuildKyselyPlanOptions } from './plan';
import { buildKyselyPlan } from './plan';

class LaneWhereExpr implements ToWhereExpr {
  readonly #bound: BoundWhereExpr;

  constructor(bound: BoundWhereExpr) {
    this.#bound = bound;
  }

  toWhereExpr(): BoundWhereExpr {
    return this.#bound;
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

  return new LaneWhereExpr({ expr: plan.ast.where });
}
