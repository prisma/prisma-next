import type { ParamDescriptor, Plan } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract-types';
import type { ColumnRef, LoweredStatement, ParamRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import type { BuildOptions, ParamPlaceholder } from '@prisma-next/sql-relational-core/types';
import type { OrmContext } from '../orm/context';
import { createInsertAst, createParamRef, createTableRef } from '../utils/ast';
import {
  assertColumnExists,
  assertParameterExists,
  errorCreateRequiresFields,
  errorModelNotFound,
  errorUnknownTable,
} from '../utils/errors';
import { createParamDescriptor } from '../utils/param-descriptor';

export function convertModelFieldsToColumns<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
  modelName: string,
  fields: Record<string, unknown>,
): Record<string, ParamPlaceholder> {
  const model = contract.models[modelName];
  if (!model || typeof model !== 'object' || !('fields' in model)) {
    throw new Error(`Model ${modelName} does not have fields`);
  }
  const modelFields = model.fields as Record<string, { column?: string }>;

  const result: Record<string, ParamPlaceholder> = {};

  for (const fieldName in fields) {
    if (!Object.hasOwn(fields, fieldName)) {
      continue;
    }

    if (!Object.hasOwn(modelFields, fieldName)) {
      throw new Error(`Field ${fieldName} does not exist on model ${modelName}`);
    }

    const field = modelFields[fieldName];
    if (!field) {
      continue;
    }

    const columnName =
      contract.mappings.fieldToColumn?.[modelName]?.[fieldName] ?? field.column ?? fieldName;

    result[columnName] = param(fieldName);
  }

  return result;
}

export function buildInsertPlan<TContract extends SqlContract<SqlStorage>>(
  context: OrmContext<TContract>,
  modelName: string,
  data: Record<string, unknown>,
  options?: BuildOptions,
): Plan<number> {
  if (!data || Object.keys(data).length === 0) {
    errorCreateRequiresFields();
  }

  const values = convertModelFieldsToColumns(context.contract, modelName, data);

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

  const insertValues: Record<string, ColumnRef | ParamRef> = {};
  for (const [columnName, placeholder] of Object.entries(values)) {
    const columnMeta = contractTable.columns[columnName];
    assertColumnExists(columnMeta, columnName, tableName);

    const paramName = placeholder.name;
    const value = assertParameterExists(paramsMap, paramName);
    const index = paramValues.push(value);

    const codecId = columnMeta.type;
    if (codecId && paramName) {
      paramCodecs[paramName] = codecId;
    }

    paramDescriptors.push(
      createParamDescriptor({
        name: paramName,
        table: tableName,
        column: columnName,
        type: codecId,
        nullable: columnMeta.nullable,
      }),
    );

    insertValues[columnName] = createParamRef(index, paramName);
  }

  const ast = createInsertAst({
    table,
    values: insertValues,
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
