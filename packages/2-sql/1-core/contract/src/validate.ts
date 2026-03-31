import type { ColumnDefaultLiteralInputValue } from '@prisma-next/contract/types';
import { isTaggedBigInt, isTaggedRaw } from '@prisma-next/contract/types';
import type { DomainContractShape, DomainModelShape } from '@prisma-next/contract/validate-domain';
import { validateContractDomain } from '@prisma-next/contract/validate-domain';
import { constructContract } from './construct';
import type { SqlContract, SqlStorage, StorageColumn, StorageTable } from './types';
import { applyFkDefaults } from './types';
import { validateSqlContract, validateStorageSemantics } from './validators';

function extractDomainShape(contract: SqlContract<SqlStorage>): DomainContractShape {
  return {
    roots: contract.roots,
    models: contract.models as Record<string, DomainModelShape>,
  };
}

function validateContractLogic(contract: SqlContract<SqlStorage>): void {
  const tableNames = new Set(Object.keys(contract.storage.tables));

  for (const [tableName, table] of Object.entries(contract.storage.tables)) {
    const columnNames = new Set(Object.keys(table.columns));

    if (table.primaryKey) {
      for (const colName of table.primaryKey.columns) {
        if (!columnNames.has(colName)) {
          throw new Error(
            `Table "${tableName}" primaryKey references non-existent column "${colName}"`,
          );
        }
      }
    }

    for (const unique of table.uniques) {
      for (const colName of unique.columns) {
        if (!columnNames.has(colName)) {
          throw new Error(
            `Table "${tableName}" unique constraint references non-existent column "${colName}"`,
          );
        }
      }
    }

    for (const index of table.indexes) {
      for (const colName of index.columns) {
        if (!columnNames.has(colName)) {
          throw new Error(`Table "${tableName}" index references non-existent column "${colName}"`);
        }
      }
    }

    for (const [colName, column] of Object.entries(table.columns)) {
      if (!column.nullable && column.default?.kind === 'literal' && column.default.value === null) {
        throw new Error(
          `Table "${tableName}" column "${colName}" is NOT NULL but has a literal null default`,
        );
      }
    }

    for (const fk of table.foreignKeys) {
      for (const colName of fk.columns) {
        if (!columnNames.has(colName)) {
          throw new Error(
            `Table "${tableName}" foreignKey references non-existent column "${colName}"`,
          );
        }
      }

      if (!tableNames.has(fk.references.table)) {
        throw new Error(
          `Table "${tableName}" foreignKey references non-existent table "${fk.references.table}"`,
        );
      }

      const referencedTable = contract.storage.tables[
        fk.references.table
      ] as (typeof contract.storage.tables)[string];
      const referencedColumnNames = new Set(Object.keys(referencedTable.columns));
      for (const colName of fk.references.columns) {
        if (!referencedColumnNames.has(colName)) {
          throw new Error(
            `Table "${tableName}" foreignKey references non-existent column "${colName}" in table "${fk.references.table}"`,
          );
        }
      }

      if (fk.columns.length !== fk.references.columns.length) {
        throw new Error(
          `Table "${tableName}" foreignKey column count (${fk.columns.length}) does not match referenced column count (${fk.references.columns.length})`,
        );
      }
    }
  }
}

const BIGINT_NATIVE_TYPES = new Set(['bigint', 'int8']);

export function isBigIntColumn(column: StorageColumn): boolean {
  const nativeType = column.nativeType?.toLowerCase() ?? '';
  if (BIGINT_NATIVE_TYPES.has(nativeType)) return true;
  const codecId = column.codecId?.toLowerCase() ?? '';
  return codecId.includes('int8') || codecId.includes('bigint');
}

export function decodeDefaultLiteralValue(
  value: ColumnDefaultLiteralInputValue,
  column: StorageColumn,
  tableName: string,
  columnName: string,
): ColumnDefaultLiteralInputValue {
  if (value instanceof Date) {
    return value;
  }
  if (isTaggedRaw(value)) {
    return value.value;
  }
  if (isTaggedBigInt(value)) {
    if (!isBigIntColumn(column)) {
      return value;
    }
    try {
      return BigInt(value.value);
    } catch {
      throw new Error(
        `Invalid tagged bigint for default value on "${tableName}.${columnName}": "${value.value}" is not a valid integer`,
      );
    }
  }
  return value;
}

export function decodeContractDefaults<T extends SqlContract<SqlStorage>>(contract: T): T {
  const tables = contract.storage.tables;
  let tablesChanged = false;
  const decodedTables: Record<string, StorageTable> = {};

  for (const [tableName, table] of Object.entries(tables)) {
    let columnsChanged = false;
    const decodedColumns: Record<string, StorageColumn> = {};

    for (const [columnName, column] of Object.entries(table.columns)) {
      if (column.default?.kind === 'literal') {
        const decodedValue = decodeDefaultLiteralValue(
          column.default.value,
          column,
          tableName,
          columnName,
        );
        if (decodedValue !== column.default.value) {
          columnsChanged = true;
          decodedColumns[columnName] = {
            ...column,
            default: { kind: 'literal', value: decodedValue },
          };
          continue;
        }
      }
      decodedColumns[columnName] = column;
    }

    if (columnsChanged) {
      tablesChanged = true;
      decodedTables[tableName] = { ...table, columns: decodedColumns };
    } else {
      decodedTables[tableName] = table;
    }
  }

  if (!tablesChanged) {
    return contract;
  }

  // The spread widens to SqlContract<SqlStorage>, but this transformation only
  // decodes tagged bigint defaults for bigint-like columns and preserves all
  // other properties of T.
  return {
    ...contract,
    storage: {
      ...contract.storage,
      tables: decodedTables,
    },
  } as T;
}

function normalizeStorage(contractObj: Record<string, unknown>): Record<string, unknown> {
  const normalizedStorage = contractObj['storage'];
  if (!normalizedStorage || typeof normalizedStorage !== 'object')
    return normalizedStorage as Record<string, unknown>;

  const storage = normalizedStorage as Record<string, unknown>;
  const tables = storage['tables'] as Record<string, unknown> | undefined;
  if (!tables) return storage;

  const normalizedTables: Record<string, unknown> = {};
  for (const [tableName, table] of Object.entries(tables)) {
    const tableObj = table as Record<string, unknown>;
    const columns = tableObj['columns'] as Record<string, unknown> | undefined;

    if (columns) {
      const normalizedColumns: Record<string, unknown> = {};
      for (const [columnName, column] of Object.entries(columns)) {
        const columnObj = column as Record<string, unknown>;
        normalizedColumns[columnName] = {
          ...columnObj,
          nullable: columnObj['nullable'] ?? false,
        };
      }

      const rawForeignKeys = (tableObj['foreignKeys'] ?? []) as Array<Record<string, unknown>>;
      const normalizedForeignKeys = rawForeignKeys.map((fk) => ({
        ...fk,
        ...applyFkDefaults({
          constraint: typeof fk['constraint'] === 'boolean' ? fk['constraint'] : undefined,
          index: typeof fk['index'] === 'boolean' ? fk['index'] : undefined,
        }),
      }));

      normalizedTables[tableName] = {
        ...tableObj,
        columns: normalizedColumns,
        uniques: tableObj['uniques'] ?? [],
        indexes: tableObj['indexes'] ?? [],
        foreignKeys: normalizedForeignKeys,
      };
    } else {
      normalizedTables[tableName] = tableObj;
    }
  }

  return { ...storage, tables: normalizedTables };
}

type RawModel = Record<string, unknown>;
type RawField = Record<string, unknown>;
type RawRelation = Record<string, unknown>;
type RawStorageObj = { tables: Record<string, Record<string, unknown>> };

function detectFormat(models: Record<string, RawModel>): 'old' | 'new' {
  for (const model of Object.values(models)) {
    const fields = model['fields'] as Record<string, RawField> | undefined;
    if (!fields) continue;
    for (const field of Object.values(fields)) {
      if ('column' in field) return 'old';
      if ('codecId' in field) return 'new';
    }
  }
  return 'old';
}

function buildColumnToFieldMap(fields: Record<string, RawField>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [fieldName, field] of Object.entries(fields)) {
    const col = field['column'] as string | undefined;
    if (col) map[col] = fieldName;
  }
  return map;
}

function enrichOldFormatModels(
  models: Record<string, RawModel>,
  storageObj: RawStorageObj,
  topRelations: Record<string, Record<string, RawRelation>>,
): { enrichedModels: Record<string, RawModel>; roots: Record<string, string> } {
  const roots: Record<string, string> = {};
  const tableToModel: Record<string, string> = {};

  for (const [modelName, model] of Object.entries(models)) {
    const modelStorage = model['storage'] as Record<string, unknown> | undefined;
    const tableName = modelStorage?.['table'] as string | undefined;
    if (tableName) {
      roots[modelName] = modelName;
      tableToModel[tableName] = modelName;
    }
  }

  const enrichedModels: Record<string, RawModel> = {};

  for (const [modelName, model] of Object.entries(models)) {
    const fields = (model['fields'] ?? {}) as Record<string, RawField>;
    const modelStorage = model['storage'] as Record<string, unknown> | undefined;
    const tableName = modelStorage?.['table'] as string | undefined;
    const storageTable = tableName
      ? (storageObj.tables[tableName] as Record<string, unknown> | undefined)
      : undefined;
    const storageColumns = (storageTable?.['columns'] ?? {}) as Record<
      string,
      Record<string, unknown>
    >;

    const enrichedFields: Record<string, RawField> = {};
    const modelStorageFields: Record<string, { column: string }> = {};

    for (const [fieldName, field] of Object.entries(fields)) {
      const colName = field['column'] as string;
      const storageCol = storageColumns[colName];
      enrichedFields[fieldName] = {
        ...field,
        nullable: storageCol?.['nullable'] ?? false,
        codecId: storageCol?.['codecId'] ?? '',
      };
      modelStorageFields[fieldName] = { column: colName };
    }

    const enrichedStorage = {
      ...(modelStorage ?? {}),
      fields: modelStorageFields,
    };

    enrichedModels[modelName] = {
      ...model,
      fields: enrichedFields,
      storage: enrichedStorage,
      relations: model['relations'] ?? {},
    };
  }

  for (const [tableName, tableRels] of Object.entries(topRelations)) {
    const modelName = tableToModel[tableName];
    if (!modelName) continue;
    const existingModel = enrichedModels[modelName];
    if (!existingModel) continue;

    const existingRels = (existingModel['relations'] ?? {}) as Record<string, unknown>;
    const targetColumnToField: Record<string, Record<string, string>> = {};

    const modelRelations: Record<string, unknown> = { ...existingRels };
    for (const [relName, rel] of Object.entries(tableRels)) {
      const on = rel['on'] as { childCols?: string[]; parentCols?: string[] } | undefined;
      const parentCols = on?.['parentCols'] ?? [];
      const childCols = on?.['childCols'] ?? [];

      const toModel = rel['to'] as string;
      const sourceFields = (existingModel['fields'] ?? {}) as Record<string, RawField>;
      const sourceColToField = buildColumnToFieldMap(sourceFields);

      if (!targetColumnToField[toModel]) {
        const targetModelObj = enrichedModels[toModel];
        if (targetModelObj) {
          targetColumnToField[toModel] = buildColumnToFieldMap(
            (targetModelObj['fields'] ?? {}) as Record<string, RawField>,
          );
        } else {
          targetColumnToField[toModel] = {};
        }
      }
      const targetColToField = targetColumnToField[toModel] ?? {};

      // Old format: parentCols = columns on FK-holding table (local), childCols = columns on referenced table (target)
      const localFields = parentCols.map((c: string) => sourceColToField[c] ?? c);
      const targetFields = childCols.map((c: string) => targetColToField[c] ?? c);

      modelRelations[relName] = {
        to: toModel,
        cardinality: rel['cardinality'],
        strategy: 'reference',
        on: { localFields, targetFields },
      };
    }

    enrichedModels[modelName] = {
      ...existingModel,
      relations: modelRelations,
    };
  }

  return { enrichedModels, roots };
}

function enrichNewFormatModels(models: Record<string, RawModel>): {
  enrichedModels: Record<string, RawModel>;
  topRelations: Record<string, Record<string, unknown>>;
} {
  const enrichedModels: Record<string, RawModel> = {};
  const topRelations: Record<string, Record<string, unknown>> = {};
  const modelToTable: Record<string, string> = {};

  for (const [modelName, model] of Object.entries(models)) {
    const modelStorage = model['storage'] as Record<string, unknown> | undefined;
    const tableName = modelStorage?.['table'] as string | undefined;
    if (tableName) modelToTable[modelName] = tableName;
  }

  for (const [modelName, model] of Object.entries(models)) {
    const fields = (model['fields'] ?? {}) as Record<string, RawField>;
    const modelStorage = model['storage'] as Record<string, unknown> | undefined;
    const storageFields = (modelStorage?.['fields'] ?? {}) as Record<
      string,
      Record<string, unknown>
    >;

    const enrichedFields: Record<string, RawField> = {};
    for (const [fieldName, field] of Object.entries(fields)) {
      const sfEntry = storageFields[fieldName];
      const column = sfEntry?.['column'] as string | undefined;
      enrichedFields[fieldName] = column ? { ...field, column } : { ...field };
    }

    enrichedModels[modelName] = {
      ...model,
      fields: enrichedFields,
      relations: model['relations'] ?? {},
    };

    const modelRels = (model['relations'] ?? {}) as Record<string, RawRelation>;
    const tableName = modelToTable[modelName];
    if (!tableName) continue;

    for (const [relName, rel] of Object.entries(modelRels)) {
      const on = rel['on'] as { localFields?: string[]; targetFields?: string[] } | undefined;
      if (!on) continue;
      const toModel = rel['to'] as string;
      const toTable = modelToTable[toModel];
      if (!toTable) continue;

      const sourceFields = enrichedFields;
      const targetModelObj = models[toModel];
      const targetFields = (targetModelObj?.['fields'] ?? {}) as Record<string, RawField>;
      const targetStorageObj = targetModelObj?.['storage'] as Record<string, unknown> | undefined;
      const targetStorageFields = (targetStorageObj?.['fields'] ?? {}) as Record<
        string,
        Record<string, unknown>
      >;

      const parentCols = (on.localFields ?? []).map((f: string) => {
        const sf = storageFields[f];
        return (
          (sf?.['column'] as string | undefined) ??
          (sourceFields[f]?.['column'] as string | undefined) ??
          f
        );
      });

      const childCols = (on.targetFields ?? []).map((f: string) => {
        const tsf = targetStorageFields[f];
        return (
          (tsf?.['column'] as string | undefined) ??
          (targetFields[f]?.['column'] as string | undefined) ??
          f
        );
      });

      if (!topRelations[tableName]) topRelations[tableName] = {};
      topRelations[tableName][relName] = {
        to: toModel,
        cardinality: rel['cardinality'],
        on: { parentCols, childCols },
      };
    }
  }

  return { enrichedModels, topRelations };
}

export function normalizeContract(contract: unknown): SqlContract<SqlStorage> {
  if (typeof contract !== 'object' || contract === null) {
    return contract as SqlContract<SqlStorage>;
  }

  const contractObj = contract as Record<string, unknown>;
  const normalizedStorage = normalizeStorage(contractObj);

  const rawModels = contractObj['models'];
  if (!rawModels || typeof rawModels !== 'object' || rawModels === null) {
    return {
      ...contractObj,
      roots: contractObj['roots'] ?? {},
      models: rawModels ?? {},
      relations: contractObj['relations'] ?? {},
      storage: normalizedStorage,
      extensionPacks: contractObj['extensionPacks'] ?? {},
      capabilities: contractObj['capabilities'] ?? {},
      meta: contractObj['meta'] ?? {},
      sources: contractObj['sources'] ?? {},
    } as SqlContract<SqlStorage>;
  }

  const modelsObj = rawModels as Record<string, RawModel>;
  const format = detectFormat(modelsObj);

  let normalizedModels: Record<string, RawModel>;
  let roots: Record<string, string>;
  let topRelations: Record<string, Record<string, unknown>>;

  if (format === 'new') {
    const result = enrichNewFormatModels(modelsObj);
    normalizedModels = result.enrichedModels;
    topRelations = {
      ...((contractObj['relations'] ?? {}) as Record<string, Record<string, unknown>>),
      ...result.topRelations,
    };
    roots = (contractObj['roots'] as Record<string, string>) ?? {};
  } else {
    const rawStorageObj =
      normalizedStorage && typeof normalizedStorage === 'object'
        ? (normalizedStorage as Record<string, unknown>)
        : {};
    const storageObj = {
      tables: ((rawStorageObj as Record<string, unknown>)['tables'] ?? {}) as Record<
        string,
        Record<string, unknown>
      >,
    };
    const existingRelations = (contractObj['relations'] ?? {}) as Record<
      string,
      Record<string, RawRelation>
    >;
    const result = enrichOldFormatModels(modelsObj, storageObj, existingRelations);
    normalizedModels = result.enrichedModels;
    roots = result.roots;
    topRelations = existingRelations;
  }

  return {
    ...contractObj,
    roots,
    models: normalizedModels,
    relations: topRelations,
    storage: normalizedStorage,
    extensionPacks: contractObj['extensionPacks'] ?? {},
    capabilities: contractObj['capabilities'] ?? {},
    meta: contractObj['meta'] ?? {},
    sources: contractObj['sources'] ?? {},
  } as SqlContract<SqlStorage>;
}

export function validateContract<TContract extends SqlContract<SqlStorage>>(
  value: unknown,
): TContract {
  const normalized = normalizeContract(value);

  const structurallyValid = validateSqlContract<SqlContract<SqlStorage>>(normalized);

  validateContractDomain(extractDomainShape(structurallyValid));

  validateContractLogic(structurallyValid);

  const semanticErrors = validateStorageSemantics(structurallyValid.storage);
  if (semanticErrors.length > 0) {
    throw new Error(`Contract semantic validation failed: ${semanticErrors.join('; ')}`);
  }

  const constructed = constructContract<TContract>(structurallyValid);
  return decodeContractDefaults(constructed) as TContract;
}
