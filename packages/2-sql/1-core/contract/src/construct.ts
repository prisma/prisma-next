import type { ModelDefinition, SqlContract, SqlMappings, SqlStorage } from './types';

type ResolvedMappings = {
  modelToTable: Record<string, string>;
  tableToModel: Record<string, string>;
  fieldToColumn: Record<string, Record<string, string>>;
  columnToField: Record<string, Record<string, string>>;
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
  };
}

function assertInverseModelMappings(
  modelToTable: Record<string, string>,
  tableToModel: Record<string, string>,
): void {
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
): void {
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
  };
}

type ValidatedContractInput = SqlContract<SqlStorage> & { _generated?: unknown };

function stripGenerated(obj: ValidatedContractInput): Omit<ValidatedContractInput, '_generated'> {
  const input = obj as unknown as Record<string, unknown>;
  const { _generated: _, ...rest } = input;
  return rest as Omit<ValidatedContractInput, '_generated'>;
}

export function constructContract<TContract extends SqlContract<SqlStorage>>(
  input: ValidatedContractInput,
): TContract {
  const existingMappings = (input as { mappings?: Partial<SqlMappings> }).mappings;
  const defaultMappings = computeDefaultMappings(input.models as Record<string, ModelDefinition>);
  const mappings = mergeMappings(defaultMappings, existingMappings);

  const contractWithMappings = {
    ...stripGenerated(input),
    mappings,
  };

  return contractWithMappings as TContract;
}
