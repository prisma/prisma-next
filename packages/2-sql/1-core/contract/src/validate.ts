import type { ModelDefinition, SqlContract, SqlMappings, SqlStorage } from './types';
import { applyFkDefaults } from './types';
import { validateSqlContract } from './validators';

type ResolvedMappings = {
  modelToTable: Record<string, string>;
  tableToModel: Record<string, string>;
  fieldToColumn: Record<string, Record<string, string>>;
  columnToField: Record<string, Record<string, string>>;
  codecTypes: Record<string, { readonly output: unknown }>;
  operationTypes: Record<string, Record<string, unknown>>;
};

function computeDefaultMappings(models: Record<string, ModelDefinition>): ResolvedMappings {
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
    modelToTable,
    tableToModel,
    fieldToColumn,
    columnToField,
    codecTypes: {},
    operationTypes: {},
  };
}

function assertInverseModelMappings(
  modelToTable: Record<string, string>,
  tableToModel: Record<string, string>,
) {
  for (const [model, table] of Object.entries(modelToTable)) {
    if (tableToModel[table] !== model) {
      throw new Error(
        `Mappings override mismatch: modelToTable.${model}="${table}" is not mirrored in tableToModel`,
      );
    }
  }
  for (const [table, model] of Object.entries(tableToModel)) {
    if (modelToTable[model] !== table) {
      throw new Error(
        `Mappings override mismatch: tableToModel.${table}="${model}" is not mirrored in modelToTable`,
      );
    }
  }
}

function assertInverseFieldMappings(
  fieldToColumn: Record<string, Record<string, string>>,
  columnToField: Record<string, Record<string, string>>,
  modelToTable: Record<string, string>,
  tableToModel: Record<string, string>,
) {
  for (const [model, fields] of Object.entries(fieldToColumn)) {
    const table = modelToTable[model];
    if (!table) {
      throw new Error(
        `Mappings override mismatch: fieldToColumn references unknown model "${model}"`,
      );
    }
    const reverseFields = columnToField[table];
    if (!reverseFields) {
      throw new Error(
        `Mappings override mismatch: columnToField is missing table "${table}" for model "${model}"`,
      );
    }
    for (const [field, column] of Object.entries(fields)) {
      if (reverseFields[column] !== field) {
        throw new Error(
          `Mappings override mismatch: fieldToColumn.${model}.${field}="${column}" is not mirrored in columnToField.${table}`,
        );
      }
    }
  }

  for (const [table, columns] of Object.entries(columnToField)) {
    const model = tableToModel[table];
    if (!model) {
      throw new Error(
        `Mappings override mismatch: columnToField references unknown table "${table}"`,
      );
    }
    const forwardFields = fieldToColumn[model];
    if (!forwardFields) {
      throw new Error(
        `Mappings override mismatch: fieldToColumn is missing model "${model}" for table "${table}"`,
      );
    }
    for (const [column, field] of Object.entries(columns)) {
      if (forwardFields[field] !== column) {
        throw new Error(
          `Mappings override mismatch: columnToField.${table}.${column}="${field}" is not mirrored in fieldToColumn.${model}`,
        );
      }
    }
  }
}

function mergeMappings(
  defaults: ResolvedMappings,
  existingMappings?: Partial<SqlMappings>,
): ResolvedMappings {
  const hasModelToTable = existingMappings?.modelToTable !== undefined;
  const hasTableToModel = existingMappings?.tableToModel !== undefined;
  if (hasModelToTable !== hasTableToModel) {
    throw new Error(
      'Mappings override mismatch: modelToTable and tableToModel must be provided together',
    );
  }

  const hasFieldToColumn = existingMappings?.fieldToColumn !== undefined;
  const hasColumnToField = existingMappings?.columnToField !== undefined;
  if (hasFieldToColumn !== hasColumnToField) {
    throw new Error(
      'Mappings override mismatch: fieldToColumn and columnToField must be provided together',
    );
  }

  const modelToTable: Record<string, string> = hasModelToTable
    ? (existingMappings?.modelToTable ?? {})
    : defaults.modelToTable;
  const tableToModel: Record<string, string> = hasTableToModel
    ? (existingMappings?.tableToModel ?? {})
    : defaults.tableToModel;
  assertInverseModelMappings(modelToTable, tableToModel);

  const fieldToColumn: Record<string, Record<string, string>> = hasFieldToColumn
    ? (existingMappings?.fieldToColumn ?? {})
    : defaults.fieldToColumn;
  const columnToField: Record<string, Record<string, string>> = hasColumnToField
    ? (existingMappings?.columnToField ?? {})
    : defaults.columnToField;
  assertInverseFieldMappings(fieldToColumn, columnToField, modelToTable, tableToModel);

  return {
    modelToTable,
    tableToModel,
    fieldToColumn,
    columnToField,
    codecTypes: { ...defaults.codecTypes, ...(existingMappings?.codecTypes ?? {}) },
    operationTypes: { ...defaults.operationTypes, ...(existingMappings?.operationTypes ?? {}) },
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

function normalizeContract(contract: unknown): SqlContract<SqlStorage> {
  if (typeof contract !== 'object' || contract === null) {
    return contract as SqlContract<SqlStorage>;
  }

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

          // Normalize foreign keys: add constraint/index defaults if missing
          const rawForeignKeys = (tableObj['foreignKeys'] ?? []) as Array<Record<string, unknown>>;
          const normalizedForeignKeys = rawForeignKeys.map((fk) => ({
            ...fk,
            ...applyFkDefaults(fk as { constraint?: boolean; index?: boolean }),
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
  const defaultMappings = computeDefaultMappings(
    structurallyValid.models as Record<string, ModelDefinition>,
  );
  const mappings = mergeMappings(defaultMappings, existingMappings);

  return {
    ...structurallyValid,
    mappings,
  } as TContract;
}
