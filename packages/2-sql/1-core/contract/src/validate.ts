import type { ColumnDefaultLiteralInputValue, Contract } from '@prisma-next/contract/types';
import { isTaggedBigInt, isTaggedRaw } from '@prisma-next/contract/types';
import {
  ContractValidationError,
  validateContract as frameworkValidateContract,
} from '@prisma-next/contract/validate-contract';
import type { SqlModelStorage, SqlStorage, StorageColumn, StorageTable } from './types';
import { applyFkDefaults } from './types';
import { validateSqlContract, validateStorageSemantics } from './validators';

/**
 * Normalizes raw contract JSON before validation. The emitter may omit fields
 * that have well-known defaults (e.g. `nullable: false` on columns,
 * `roots: {}` at top level). This function fills them in so the strict
 * structural schemas pass.
 */
function normalizeRawContract(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const obj = { ...(value as Record<string, unknown>) };

  if (!('roots' in obj)) obj['roots'] = {};
  delete obj['warnings'];

  const topStorageHash = obj['storageHash'] as string | undefined;

  const storage = obj['storage'];
  if (storage && typeof storage === 'object') {
    const s = { ...(storage as Record<string, unknown>) };

    if (!('storageHash' in s) && topStorageHash) {
      s['storageHash'] = topStorageHash;
    }

    const tables = s['tables'];
    if (tables && typeof tables === 'object') {
      const normalizedTables: Record<string, unknown> = {};
      for (const [tableName, table] of Object.entries(tables as Record<string, unknown>)) {
        if (!table || typeof table !== 'object') {
          normalizedTables[tableName] = table;
          continue;
        }
        const t = { ...(table as Record<string, unknown>) };

        const columns = t['columns'];
        if (columns && typeof columns === 'object') {
          const normalizedColumns: Record<string, unknown> = {};
          for (const [colName, col] of Object.entries(columns as Record<string, unknown>)) {
            if (!col || typeof col !== 'object') {
              normalizedColumns[colName] = col;
              continue;
            }
            const c = col as Record<string, unknown>;
            normalizedColumns[colName] = 'nullable' in c ? c : { ...c, nullable: false };
          }
          t['columns'] = normalizedColumns;
        }

        const rawForeignKeys = (t['foreignKeys'] ?? []) as Array<Record<string, unknown>>;
        t['foreignKeys'] = rawForeignKeys.map((fk) => ({
          ...fk,
          ...applyFkDefaults({
            constraint: typeof fk['constraint'] === 'boolean' ? fk['constraint'] : undefined,
            index: typeof fk['index'] === 'boolean' ? fk['index'] : undefined,
          }),
        }));

        if (!('uniques' in t)) t['uniques'] = [];
        if (!('indexes' in t)) t['indexes'] = [];

        normalizedTables[tableName] = t;
      }
      s['tables'] = normalizedTables;
    }
    obj['storage'] = s;
  }

  const topExecutionHash = obj['executionHash'] as string | undefined;
  const execution = obj['execution'];
  if (execution && typeof execution === 'object') {
    const e = execution as Record<string, unknown>;
    if (!('executionHash' in e) && topExecutionHash) {
      obj['execution'] = { ...e, executionHash: topExecutionHash };
    }
  }
  delete obj['executionHash'];

  return obj;
}

function validateModelStorageReferences(contract: Contract<SqlStorage>): void {
  for (const [modelName, model] of Object.entries(contract.models)) {
    const modelStorage = model.storage as SqlModelStorage;
    const storageTable = modelStorage.table;

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
    for (const [fieldName, field] of Object.entries(modelStorage.fields)) {
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
    throw new ContractValidationError(
      `Contract semantic validation failed: ${semanticErrors.join('; ')}`,
      'storage',
    );
  }
}

const BIGINT_NATIVE_TYPES = new Set(['bigint', 'int8']);

export function isBigIntColumn(column: StorageColumn): boolean {
  const nativeType = column.nativeType.toLowerCase();
  if (BIGINT_NATIVE_TYPES.has(nativeType)) return true;
  const codecId = column.codecId.toLowerCase();
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
  const normalized = normalizeRawContract(value);
  const validated = frameworkValidateContract<TContract>(normalized, validateSqlStorage);
  return decodeContractDefaults(validated);
}
