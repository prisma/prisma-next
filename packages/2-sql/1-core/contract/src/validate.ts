import type { ModelDefinition, SqlContract, SqlMappings, SqlStorage } from './types';
import { validateSqlContract } from './validators';

function normalizeContract(contract: unknown): SqlContract<SqlStorage> {
  const contractObj = contract as Record<string, unknown>;

  let normalizedStorage = contractObj.storage;
  if (normalizedStorage && typeof normalizedStorage === 'object') {
    const storage = normalizedStorage as Record<string, unknown>;
    const tables = storage.tables as Record<string, unknown> | undefined;

    if (tables) {
      const normalizedTables: Record<string, unknown> = {};
      for (const [tableName, table] of Object.entries(tables)) {
        const tableObj = table as Record<string, unknown>;
        const columns = tableObj.columns as Record<string, unknown> | undefined;

        if (!columns) {
          normalizedTables[tableName] = tableObj;
          continue;
        }

        const normalizedColumns: Record<string, unknown> = {};
        for (const [columnName, column] of Object.entries(columns)) {
          const columnObj = column as Record<string, unknown>;
          normalizedColumns[columnName] = {
            ...columnObj,
            nullable: columnObj.nullable ?? false,
          };
        }

        normalizedTables[tableName] = {
          ...tableObj,
          columns: normalizedColumns,
          uniques: tableObj.uniques ?? [],
          indexes: tableObj.indexes ?? [],
          foreignKeys: tableObj.foreignKeys ?? [],
        };
      }

      normalizedStorage = {
        ...storage,
        tables: normalizedTables,
      };
    }
  }

  let normalizedModels = contractObj.models;
  if (normalizedModels && typeof normalizedModels === 'object') {
    const models = normalizedModels as Record<string, unknown>;
    const normalizedModelsObj: Record<string, unknown> = {};
    for (const [modelName, model] of Object.entries(models)) {
      const modelObj = model as Record<string, unknown>;
      normalizedModelsObj[modelName] = {
        ...modelObj,
        relations: modelObj.relations ?? {},
      };
    }
    normalizedModels = normalizedModelsObj;
  }

  return {
    ...contractObj,
    models: normalizedModels,
    relations: contractObj.relations ?? {},
    storage: normalizedStorage,
    extensionPacks: contractObj.extensionPacks ?? {},
    capabilities: contractObj.capabilities ?? {},
    meta: contractObj.meta ?? {},
    sources: contractObj.sources ?? {},
  } as SqlContract<SqlStorage>;
}

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
      modelFieldToColumn[fieldName] = field.column;

      if (!columnToField[tableName]) {
        columnToField[tableName] = {};
      }
      columnToField[tableName][field.column] = fieldName;
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

  if (contract.storage.types) {
    for (const [typeName, typeInstance] of Object.entries(contract.storage.types)) {
      if (Array.isArray(typeInstance.typeParams)) {
        throw new Error(
          `Type instance "${typeName}" has invalid typeParams: must be a plain object, not an array`,
        );
      }
    }
  }

  for (const [tableName, table] of Object.entries(contract.storage.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      if (column.typeParams !== undefined && column.typeRef !== undefined) {
        throw new Error(
          `Column "${columnName}" in table "${tableName}" has both typeParams and typeRef; these are mutually exclusive`,
        );
      }

      if (column.typeParams !== undefined && Array.isArray(column.typeParams)) {
        throw new Error(
          `Column "${columnName}" in table "${tableName}" has invalid typeParams: must be a plain object, not an array`,
        );
      }

      if (column.typeRef !== undefined) {
        const referencedType = contract.storage.types?.[column.typeRef];
        if (!referencedType) {
          throw new Error(
            `Column "${columnName}" in table "${tableName}" references non-existent type instance "${column.typeRef}" (not found in storage.types)`,
          );
        }

        if (column.codecId !== referencedType.codecId) {
          throw new Error(
            `Column "${columnName}" in table "${tableName}" has codecId "${column.codecId}" but references type instance "${column.typeRef}" with codecId "${referencedType.codecId}"`,
          );
        }

        if (column.nativeType !== referencedType.nativeType) {
          throw new Error(
            `Column "${columnName}" in table "${tableName}" has nativeType "${column.nativeType}" but references type instance "${column.typeRef}" with nativeType "${referencedType.nativeType}"`,
          );
        }
      }
    }
  }

  for (const [modelName, model] of Object.entries(contract.models)) {
    const tableName = model.storage.table;
    if (!tableNames.has(tableName)) {
      throw new Error(`Model "${modelName}" references non-existent table "${tableName}"`);
    }

    const table = contract.storage.tables[tableName];
    if (!table.primaryKey) {
      throw new Error(`Model "${modelName}" table "${tableName}" is missing a primary key`);
    }

    const columnNames = new Set(Object.keys(table.columns));
    for (const [fieldName, field] of Object.entries(model.fields)) {
      if (!columnNames.has(field.column)) {
        throw new Error(
          `Model "${modelName}" field "${fieldName}" references non-existent column "${field.column}" in table "${tableName}"`,
        );
      }
    }

    for (const [relationName, relation] of Object.entries(model.relations)) {
      if (
        typeof relation !== 'object' ||
        relation === null ||
        !('on' in relation) ||
        !('to' in relation)
      ) {
        continue;
      }

      const on = relation.on as { parentCols?: string[]; childCols?: string[] };
      const cardinality = (relation as { cardinality?: string }).cardinality;
      if (!on.parentCols || !on.childCols || cardinality === '1:N') {
        continue;
      }

      const hasMatchingFk = table.foreignKeys.some((fk) => {
        return (
          fk.columns.length === on.childCols.length &&
          fk.columns.every((col, i) => col === on.childCols?.[i]) &&
          fk.references.columns.length === on.parentCols.length &&
          fk.references.columns.every((col, i) => col === on.parentCols?.[i])
        );
      });

      if (!hasMatchingFk) {
        throw new Error(
          `Model "${modelName}" relation "${relationName}" does not have a corresponding foreign key in table "${tableName}"`,
        );
      }
    }
  }

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

export function validateContract<TContract extends SqlContract<SqlStorage>>(
  value: unknown,
): TContract {
  const normalized = normalizeContract(value);
  const structurallyValid = validateSqlContract<SqlContract<SqlStorage>>(normalized);
  validateContractLogic(structurallyValid);

  const existingMappings = (structurallyValid as { mappings?: Partial<SqlMappings> }).mappings;
  const mappings = computeMappings(structurallyValid.models, existingMappings);

  return {
    ...structurallyValid,
    mappings,
  } as TContract;
}
