import type { ParamDescriptor, PlanMeta } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { QueryAst, SelectAst } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';

export function resolveTableColumns(
  contract: SqlContract<SqlStorage>,
  tableName: string,
): string[] {
  const table = contract.storage.tables[tableName];
  if (!table) {
    throw new Error(`Unknown table "${tableName}" in SQL ORM query planner`);
  }
  return Object.keys(table.columns);
}

export function buildOrmPlanMeta(
  contract: SqlContract<SqlStorage>,
  paramDescriptors: readonly ParamDescriptor[] = [],
): PlanMeta {
  return {
    target: contract.target,
    targetFamily: contract.targetFamily,
    storageHash: contract.storageHash,
    ...(contract.profileHash !== undefined ? { profileHash: contract.profileHash } : {}),
    lane: 'orm-client',
    paramDescriptors: [...paramDescriptors],
  };
}

export function buildOrmQueryPlan<Row>(
  contract: SqlContract<SqlStorage>,
  ast: QueryAst,
  params: readonly unknown[],
  paramDescriptors: readonly ParamDescriptor[] = [],
): SqlQueryPlan<Row> {
  const annotations =
    ast.kind === 'select' && typeof (ast as SelectAst).limit === 'number'
      ? { limit: (ast as SelectAst).limit }
      : undefined;

  return Object.freeze({
    ast,
    params: [...params],
    meta: {
      ...buildOrmPlanMeta(contract, paramDescriptors),
      ...(annotations ? { annotations } : {}),
    },
  });
}
