import type { ColumnDefaultLiteralInputValue } from '@prisma-next/contract/types';
import { isTaggedBigInt, isTaggedRaw } from '@prisma-next/contract/types';
import { constructContract } from './construct';
import type { SqlContract, SqlStorage, StorageColumn, StorageTable } from './types';
import { applyFkDefaults } from './types';
import { validateSqlContract, validateStorageSemantics } from './validators';

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

export function normalizeContract(contract: unknown): SqlContract<SqlStorage> {
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

  const semanticErrors = validateStorageSemantics(structurallyValid.storage);
  if (semanticErrors.length > 0) {
    throw new Error(`Contract semantic validation failed: ${semanticErrors.join('; ')}`);
  }

  const constructed = constructContract<TContract>(structurallyValid);
  return decodeContractDefaults(constructed) as TContract;
}
