import type { ParamDescriptor, PlanMeta } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { AnyQueryAst, ParamRef } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';

function resolveProjectionCodecs(
  contract: SqlContract<SqlStorage>,
  ast: AnyQueryAst,
): Record<string, string> | undefined {
  const codecs: Record<string, string> = {};

  if (ast.kind === 'select') {
    for (const item of ast.projection) {
      if (item.expr.kind === 'column-ref') {
        const table = contract.storage.tables[item.expr.table];
        const col = table?.columns[item.expr.column];
        if (col?.codecId) {
          codecs[item.alias] = col.codecId;
        }
      }
    }
  } else if (ast.returning) {
    const tableName = ast.table.name;
    const table = contract.storage.tables[tableName];
    if (!table) return undefined;

    for (const colRef of ast.returning) {
      const col = table.columns[colRef.column];
      if (col?.codecId) {
        codecs[colRef.column] = col.codecId;
      }
    }
  }

  return Object.keys(codecs).length > 0 ? codecs : undefined;
}

export function deriveParamsFromAst(ast: { collectParamRefs(): ParamRef[] }): {
  params: unknown[];
  paramDescriptors: ParamDescriptor[];
} {
  const collectedParams = [...new Set(ast.collectParamRefs())];
  return {
    params: collectedParams.map((p) => p.value),
    paramDescriptors: collectedParams.map((p) => ({
      ...ifDefined('name', p.name),
      ...ifDefined('codecId', p.codecId),
      source: 'dsl' as const,
    })),
  };
}

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
  ast: AnyQueryAst,
  params: readonly unknown[],
  paramDescriptors: readonly ParamDescriptor[] = [],
): SqlQueryPlan<Row> {
  const projectionTypes = resolveProjectionCodecs(contract, ast);
  const codecAnnotations = projectionTypes
    ? { codecs: Object.freeze({ ...projectionTypes }) }
    : undefined;
  const limitAnnotation =
    ast.kind === 'select' && ast.limit !== undefined ? { limit: ast.limit } : undefined;
  const annotations =
    codecAnnotations || limitAnnotation
      ? Object.freeze({ ...codecAnnotations, ...limitAnnotation })
      : undefined;

  return Object.freeze({
    ast,
    params: [...params],
    meta: {
      ...buildOrmPlanMeta(contract, paramDescriptors),
      ...ifDefined('projectionTypes', projectionTypes),
      ...ifDefined('annotations', annotations),
    },
  });
}
