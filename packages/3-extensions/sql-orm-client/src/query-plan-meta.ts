import type { PlanMeta } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { QueryAst } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';

export function buildOrmPlanMeta(contract: SqlContract<SqlStorage>): PlanMeta {
  return {
    target: contract.target,
    targetFamily: contract.targetFamily,
    storageHash: contract.storageHash,
    ...(contract.profileHash !== undefined ? { profileHash: contract.profileHash } : {}),
    lane: 'orm-client',
    paramDescriptors: [],
  };
}

export function buildOrmQueryPlan<Row>(
  contract: SqlContract<SqlStorage>,
  ast: QueryAst,
  params: readonly unknown[],
): SqlQueryPlan<Row> {
  return Object.freeze({
    ast,
    params: [...params],
    meta: buildOrmPlanMeta(contract),
  });
}
