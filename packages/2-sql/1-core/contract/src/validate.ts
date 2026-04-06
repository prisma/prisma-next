import type { Contract, ContractModel, JsonValue } from '@prisma-next/contract/types';
import {
  ContractValidationError,
  validateContract as frameworkValidateContract,
} from '@prisma-next/contract/validate-contract';
import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { SqlModelStorage, SqlStorage, StorageColumn, StorageTable } from './types';
import { validateSqlContract, validateStorageSemantics } from './validators';

type SqlValidationContract = Contract<SqlStorage, Record<string, ContractModel<SqlModelStorage>>>;

function validateModelStorageReferences(contract: SqlValidationContract): void {
  for (const [modelName, model] of Object.entries(contract.models)) {
    const storageTable = model.storage.table;

    const table = contract.storage.tables[storageTable] as
      | (typeof contract.storage.tables)[string]
      | undefined;
    if (!table) {
      throw new ContractValidationError(
        `Model "${modelName}" references non-existent table "${storageTable}"`,
        'storage',
      );
    }

    const columnNames = new Set(Object.keys(table.columns));
    for (const [fieldName, field] of Object.entries(model.storage.fields)) {
      if (!columnNames.has(field.column)) {
        throw new ContractValidationError(
          `Model "${modelName}" field "${fieldName}" references non-existent column "${field.column}" in table "${storageTable}"`,
          'storage',
        );
      }
    }
  }
}

function validateContractLogic(contract: Contract<SqlStorage>): void {
  const tableNames = new Set(Object.keys(contract.storage.tables));

  for (const [tableName, table] of Object.entries(contract.storage.tables)) {
    const columnNames = new Set(Object.keys(table.columns));

    if (table.primaryKey) {
      for (const colName of table.primaryKey.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Table "${tableName}" primaryKey references non-existent column "${colName}"`,
            'storage',
          );
        }
      }
    }

    for (const unique of table.uniques) {
      for (const colName of unique.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Table "${tableName}" unique constraint references non-existent column "${colName}"`,
            'storage',
          );
        }
      }
    }

    for (const index of table.indexes) {
      for (const colName of index.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Table "${tableName}" index references non-existent column "${colName}"`,
            'storage',
          );
        }
      }
    }

    for (const [colName, column] of Object.entries(table.columns)) {
      if (!column.nullable && column.default?.kind === 'literal' && column.default.value === null) {
        throw new ContractValidationError(
          `Table "${tableName}" column "${colName}" is NOT NULL but has a literal null default`,
          'storage',
        );
      }
    }

    for (const fk of table.foreignKeys) {
      for (const colName of fk.columns) {
        if (!columnNames.has(colName)) {
          throw new ContractValidationError(
            `Table "${tableName}" foreignKey references non-existent column "${colName}"`,
            'storage',
          );
        }
      }

      if (!tableNames.has(fk.references.table)) {
        throw new ContractValidationError(
          `Table "${tableName}" foreignKey references non-existent table "${fk.references.table}"`,
          'storage',
        );
      }

      const referencedTable = contract.storage.tables[fk.references.table];
      if (!referencedTable) continue;
      const referencedColumnNames = new Set(Object.keys(referencedTable.columns));
      for (const colName of fk.references.columns) {
        if (!referencedColumnNames.has(colName)) {
          throw new ContractValidationError(
            `Table "${tableName}" foreignKey references non-existent column "${colName}" in table "${fk.references.table}"`,
            'storage',
          );
        }
      }

      if (fk.columns.length !== fk.references.columns.length) {
        throw new ContractValidationError(
          `Table "${tableName}" foreignKey column count (${fk.columns.length}) does not match referenced column count (${fk.references.columns.length})`,
          'storage',
        );
      }
    }
  }
}

function validateSqlStorage(contract: Contract): void {
  const sqlContract = validateSqlContract<SqlValidationContract>(contract);
  validateContractLogic(sqlContract);
  validateModelStorageReferences(sqlContract);
  const semanticErrors = validateStorageSemantics(sqlContract.storage);
  if (semanticErrors.length > 0) {
    throw new ContractValidationError(
      `Contract semantic validation failed: ${semanticErrors.join('; ')}`,
      'storage',
    );
  }
}

function decodeContractDefaults<T extends Contract<SqlStorage>>(
  contract: T,
  codecLookup: CodecLookup,
): T {
  const tables = contract.storage.tables;
  let tablesChanged = false;
  const decodedTables: Record<string, StorageTable> = {};

  for (const [tableName, table] of Object.entries(tables)) {
    let columnsChanged = false;
    const decodedColumns: Record<string, StorageColumn> = {};

    for (const [columnName, column] of Object.entries(table.columns)) {
      if (column.default?.kind === 'literal') {
        const codec = codecLookup.get(column.codecId);
        if (codec) {
          const decodedValue = codec.decodeJson(column.default.value as JsonValue);
          if (decodedValue !== column.default.value) {
            columnsChanged = true;
            decodedColumns[columnName] = {
              ...column,
              default: { kind: 'literal', value: decodedValue },
            };
            continue;
          }
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

  return {
    ...contract,
    storage: {
      ...contract.storage,
      tables: decodedTables,
    },
  } as T;
}

export function validateContract<TContract extends Contract<SqlStorage>>(
  value: unknown,
  codecLookup: CodecLookup,
): TContract {
  const validated = frameworkValidateContract<TContract>(value, validateSqlStorage);
  try {
    return decodeContractDefaults(validated, codecLookup);
  } catch (error) {
    if (error instanceof ContractValidationError) throw error;
    throw new ContractValidationError(
      error instanceof Error ? error.message : String(error),
      'storage',
    );
  }
}
