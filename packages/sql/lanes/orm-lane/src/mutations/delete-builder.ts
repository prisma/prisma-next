import type { ParamDescriptor, Plan } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { LoweredStatement } from '@prisma-next/sql-relational-core/ast';
import type { AnyBinaryBuilder, BuildOptions } from '@prisma-next/sql-relational-core/types';
import type { OrmContext } from '../orm/context';
import type { ModelColumnAccessor } from '../orm-types';
import { buildWhereExpr } from '../selection/predicates';
import { createDeleteAst, createTableRef } from '../utils/ast';
import { errorFailedToBuildWhereClause, errorModelNotFound } from '../utils/errors';

export function buildDeletePlan<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ModelName extends string,
>(
  context: OrmContext<TContract>,
  modelName: ModelName,
  where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
  getModelAccessor: () => ModelColumnAccessor<TContract, CodecTypes, ModelName>,
  options?: BuildOptions,
): Plan<number> {
  const modelAccessor = getModelAccessor();
  const wherePredicate = where(modelAccessor);

  const tableName = context.contract.mappings.modelToTable?.[modelName];
  if (!tableName) {
    errorModelNotFound(modelName);
  }
  const table = createTableRef(tableName);

  const paramsMap = (options?.params ?? {}) as Record<string, unknown>;
  const paramDescriptors: ParamDescriptor[] = [];
  const paramValues: unknown[] = [];
  const paramCodecs: Record<string, string> = {};

  const whereResult = buildWhereExpr(
    wherePredicate,
    context.contract,
    paramsMap,
    paramDescriptors,
    paramValues,
  );
  const whereExpr = whereResult.expr;
  if (!whereExpr) {
    errorFailedToBuildWhereClause();
  }

  if (whereResult?.codecId && whereResult.paramName) {
    paramCodecs[whereResult.paramName] = whereResult.codecId;
  }

  const ast = createDeleteAst({
    table,
    where: whereExpr,
  });

  const lowered = context.adapter.lower(ast, {
    contract: context.contract,
    params: paramValues,
  });
  const loweredBody = lowered.body as LoweredStatement;

  return Object.freeze({
    ast,
    sql: loweredBody.sql,
    params: loweredBody.params ?? paramValues,
    meta: {
      target: context.contract.target,
      targetFamily: context.contract.targetFamily,
      coreHash: context.contract.coreHash,
      lane: 'orm',
      refs: {
        tables: [tableName],
        columns: [],
      },
      projection: {},
      paramDescriptors,
      ...(Object.keys(paramCodecs).length > 0
        ? {
            annotations: {
              codecs: paramCodecs,
              intent: 'write',
              isMutation: true,
            },
          }
        : {
            annotations: {
              intent: 'write',
              isMutation: true,
            },
          }),
    },
  }) as Plan<number>;
}
