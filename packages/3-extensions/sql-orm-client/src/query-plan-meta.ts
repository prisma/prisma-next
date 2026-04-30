import type { Contract, PlanMeta } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { type AnyQueryAst, collectOrderedParamRefs } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';

export function deriveParamsFromAst(ast: AnyQueryAst): {
  params: unknown[];
} {
  return {
    params: collectOrderedParamRefs(ast).map((p) => p.value),
  };
}

export function resolveTableColumns(contract: Contract<SqlStorage>, tableName: string): string[] {
  const table = contract.storage.tables[tableName];
  if (!table) {
    throw new Error(`Unknown table "${tableName}" in SQL ORM query planner`);
  }
  return Object.keys(table.columns);
}

export function buildOrmPlanMeta(contract: Contract<SqlStorage>): PlanMeta {
  return {
    target: contract.target,
    targetFamily: contract.targetFamily,
    storageHash: contract.storage.storageHash,
    ...(contract.profileHash !== undefined ? { profileHash: contract.profileHash } : {}),
    lane: 'orm-client',
  };
}

export function buildOrmQueryPlan<Row>(
  contract: Contract<SqlStorage>,
  ast: AnyQueryAst,
  params: readonly unknown[],
): SqlQueryPlan<Row> {
  return Object.freeze({
    ast,
    params: [...params],
    meta: buildOrmPlanMeta(contract),
  });
}
