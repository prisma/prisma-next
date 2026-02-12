import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ColumnRef, ParamRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
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
): SqlQueryPlan<number> {
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
  const usedColumns = new Set<string>();
  for (const [columnName, placeholder] of Object.entries(values)) {
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

    insertValues[columnName] = createParamRef(index, paramName);
    usedColumns.add(columnName);
  }

  const appliedDefaults = context.applyMutationDefaults({
    op: 'create',
    table: tableName,
    values: insertValues,
  });

  for (const defaultValue of appliedDefaults) {
    const columnMeta = contractTable.columns[defaultValue.column];
    assertColumnExists(columnMeta, defaultValue.column, tableName);
    if (usedColumns.has(defaultValue.column)) {
      continue;
    }

    const index = paramValues.push(defaultValue.value);
    paramCodecs[defaultValue.column] = columnMeta.codecId;
    paramDescriptors.push(
      createParamDescriptor({
        name: defaultValue.column,
        table: tableName,
        column: defaultValue.column,
        codecId: columnMeta.codecId,
        nativeType: columnMeta.nativeType,
        nullable: columnMeta.nullable,
      }),
    );

    insertValues[defaultValue.column] = createParamRef(index, defaultValue.column);
    usedColumns.add(defaultValue.column);
  }

  const ast = createInsertAst({
    table,
    values: insertValues,
  });

  return Object.freeze({
    ast,
    params: paramValues,
    meta: {
      target: context.contract.target,
      targetFamily: context.contract.targetFamily,
      storageHash: context.contract.storageHash,
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
