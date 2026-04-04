import type { ColumnDefaultLiteralInputValue, Contract } from '@prisma-next/contract/types';
import { isTaggedBigInt, isTaggedRaw } from '@prisma-next/contract/types';
import { validateContract as frameworkValidateContract } from '@prisma-next/contract/validate-contract';
import type { SqlStorage, StorageColumn, StorageTable } from './types';
import { validateSqlContract, validateStorageSemantics } from './validators';

function validateModelStorageReferences(contract: Contract<SqlStorage>): void {
  const models = contract.models as Record<
    string,
    { storage?: { table?: string; fields?: Record<string, { column?: string }> } }
  >;

  for (const [modelName, model] of Object.entries(models)) {
    const storageTable = model.storage?.table;
    if (!storageTable) continue;

    const table = contract.storage.tables[storageTable] as
      | (typeof contract.storage.tables)[string]
      | undefined;
    if (!table) {
      throw new Error(`Model "${modelName}" references non-existent table "${storageTable}"`);
    }

    const storageFields = model.storage?.fields;
    if (!storageFields) continue;

    const columnNames = new Set(Object.keys(table.columns));
    for (const [fieldName, field] of Object.entries(storageFields)) {
      const column = field.column;
      if (column && !columnNames.has(column)) {
        throw new Error(
          `Model "${modelName}" field "${fieldName}" references non-existent column "${column}" in table "${storageTable}"`,
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

function validateSqlStorage(contract: Contract): void {
  // Intentional layered validation: framework ContractSchema validates generic
  // shape; SQL validateSqlContract re-validates with stricter '+': 'reject' to
  // catch unknown fields. The overlap is small and ensures SQL-specific
  // constraints (e.g. storage table schema) are enforced.
  validateSqlContract(contract);
  const sqlContract = contract as Contract<SqlStorage>;
  validateContractLogic(sqlContract);
  validateModelStorageReferences(sqlContract);
  const semanticErrors = validateStorageSemantics(sqlContract.storage);
  if (semanticErrors.length > 0) {
    throw new Error(`Contract semantic validation failed: ${semanticErrors.join('; ')}`);
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

export function decodeContractDefaults<T extends Contract<SqlStorage>>(contract: T): T {
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
): TContract {
  const validated = frameworkValidateContract<TContract>(value, validateSqlStorage);
  return decodeContractDefaults(validated);
}
