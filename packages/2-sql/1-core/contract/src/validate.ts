import type { ModelDefinition, SqlContract, SqlMappings, SqlStorage } from './types';
import { validateSqlContract } from './validators';

function computeMappings(
  models: Record<string, ModelDefinition>,
  existingMappings?: Partial<SqlMappings>,
): SqlMappings {
  const modelToTable: Record<string, string> = {};
  const tableToModel: Record<string, string> = {};
  const fieldToColumn: Record<string, Record<string, string>> = {};
  const columnToField: Record<string, Record<string, string>> = {};

  for (const [modelName, model] of Object.entries(models)) {
    const tableName = model.storage.table;
    modelToTable[modelName] = tableName;
    tableToModel[tableName] = modelName;

    const modelFieldToColumn: Record<string, string> = {};
    for (const [fieldName, field] of Object.entries(model.fields)) {
      const columnName = field.column;
      modelFieldToColumn[fieldName] = columnName;
      if (!columnToField[tableName]) {
        columnToField[tableName] = {};
      }
      columnToField[tableName][columnName] = fieldName;
    }

    fieldToColumn[modelName] = modelFieldToColumn;
  }

  return {
    modelToTable: existingMappings?.modelToTable ?? modelToTable,
    tableToModel: existingMappings?.tableToModel ?? tableToModel,
    fieldToColumn: existingMappings?.fieldToColumn ?? fieldToColumn,
    columnToField: existingMappings?.columnToField ?? columnToField,
    codecTypes: existingMappings?.codecTypes ?? {},
    operationTypes: existingMappings?.operationTypes ?? {},
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

      const referencedTable = contract.storage.tables[fk.references.table];
      if (!referencedTable) {
        throw new Error(
          `Table "${tableName}" foreignKey references non-existent table "${fk.references.table}"`,
        );
      }
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

function normalizeContract(contract: unknown): SqlContract<SqlStorage> {
  const contractObj = contract as Record<string, unknown>;

  let normalizedStorage = contractObj['storage'];
  if (normalizedStorage && typeof normalizedStorage === 'object' && normalizedStorage !== null) {
    const storage = normalizedStorage as Record<string, unknown>;
    const tables = storage['tables'] as Record<string, unknown> | undefined;

    if (tables) {
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

          normalizedTables[tableName] = {
            ...tableObj,
            columns: normalizedColumns,
            uniques: tableObj['uniques'] ?? [],
            indexes: tableObj['indexes'] ?? [],
            foreignKeys: tableObj['foreignKeys'] ?? [],
          };
        } else {
          normalizedTables[tableName] = tableObj;
        }
      }

      normalizedStorage = {
        ...storage,
        tables: normalizedTables,
      };
    }
  }

  let normalizedModels = contractObj['models'];
  if (normalizedModels && typeof normalizedModels === 'object' && normalizedModels !== null) {
    const models = normalizedModels as Record<string, unknown>;
    const normalizedModelsObj: Record<string, unknown> = {};
    for (const [modelName, model] of Object.entries(models)) {
      const modelObj = model as Record<string, unknown>;
      normalizedModelsObj[modelName] = {
        ...modelObj,
        relations: modelObj['relations'] ?? {},
      };
    }
    normalizedModels = normalizedModelsObj;
  }

  return {
    ...contractObj,
    models: normalizedModels,
    relations: contractObj['relations'] ?? {},
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
  validateContractLogic(structurallyValid);

  const existingMappings = (structurallyValid as { mappings?: Partial<SqlMappings> }).mappings;
  const mappings = computeMappings(
    structurallyValid.models as Record<string, ModelDefinition>,
    existingMappings,
  );

  return {
    ...structurallyValid,
    mappings,
  } as TContract;
}
