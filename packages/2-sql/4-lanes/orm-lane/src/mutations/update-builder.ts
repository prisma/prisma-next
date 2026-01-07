import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ColumnRef, ParamRef } from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { AnyBinaryBuilder, BuildOptions } from '@prisma-next/sql-relational-core/types';
import type { OrmContext } from '../orm/context.ts';
import type { ModelColumnAccessor } from '../orm-types.ts';
import { buildWhereExpr } from '../selection/predicates.ts';
import { createParamRef, createTableRef, createUpdateAst } from '../utils/ast.ts';
import {
  assertColumnExists,
  assertParameterExists,
  errorFailedToBuildWhereClause,
  errorModelNotFound,
  errorUnknownTable,
  errorUpdateRequiresFields,
} from '../utils/errors.ts';
import { createParamDescriptor } from '../utils/param-descriptor.ts';
import { convertModelFieldsToColumns } from './insert-builder.ts';

export function buildUpdatePlan<
  TContract extends SqlContract<SqlStorage>,
  CodecTypes extends Record<string, { output: unknown }>,
  ModelName extends string,
>(
  context: OrmContext<TContract>,
  modelName: ModelName,
  where: (model: ModelColumnAccessor<TContract, CodecTypes, ModelName>) => AnyBinaryBuilder,
  getModelAccessor: () => ModelColumnAccessor<TContract, CodecTypes, ModelName>,
  data: Record<string, unknown>,
  options?: BuildOptions,
): SqlQueryPlan<number> {
  if (!data || Object.keys(data).length === 0) {
    errorUpdateRequiresFields();
  }

  const set = convertModelFieldsToColumns(context.contract, modelName, data);

  const modelAccessor = getModelAccessor();
  const wherePredicate = where(modelAccessor);

  const tableName = context.contract.mappings.modelToTable?.[modelName];
  if (!tableName) {
    errorModelNotFound(modelName);
  }
  const table = createTableRef(tableName);

  const paramsMap = {
    ...(options?.params ?? {}),
    ...data,
  } as Record<string, unknown>;
  const paramDescriptors: ParamDescriptor[] = [];
  const paramValues: unknown[] = [];
  const paramCodecs: Record<string, string> = {};

  const contractTable = context.contract.storage.tables[tableName];
  if (!contractTable) {
    errorUnknownTable(tableName);
  }

  const updateSet: Record<string, ColumnRef | ParamRef> = {};
  for (const [columnName, placeholder] of Object.entries(set)) {
    const columnMeta = contractTable.columns[columnName];
    assertColumnExists(columnMeta, columnName, tableName);

    const paramName = placeholder.name;
    const value = assertParameterExists(paramsMap, paramName);
    const index = paramValues.push(value);

    const codecId = columnMeta.codecId;
    if (paramName) {
      paramCodecs[paramName] = codecId;
    }

    paramDescriptors.push(
      createParamDescriptor({
        name: paramName,
        table: tableName,
        column: columnName,
        codecId: codecId,
        nativeType: columnMeta.nativeType,
        nullable: columnMeta.nullable,
      }),
    );

    updateSet[columnName] = createParamRef(index, paramName);
  }

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

  const ast = createUpdateAst({
    table,
    set: updateSet,
    where: whereExpr,
  });

  return Object.freeze({
    ast,
    params: paramValues,
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
  });
}
