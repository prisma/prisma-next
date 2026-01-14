import type { SqlContract, SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { param } from '@prisma-next/sql-relational-core/param';
import type { ParamPlaceholder } from '@prisma-next/sql-relational-core/types';

/**
 * Resolves userland defaults for columns not already present in the provided values.
 *
 * For each column in the table with a userland default that is not already in `providedColumns`,
 * this function generates a value using the registry and adds it to both `values` and `paramsMap`.
 *
 * @param table - The storage table definition
 * @param providedColumns - Set of column names already provided in values
 * @param values - The values map to update (column name -> placeholder)
 * @param paramsMap - The params map to update (param name -> value)
 * @param userlandGenerators - Optional registry of userland generators
 */
export function resolveUserlandDefaultsForColumns(
  table: StorageTable,
  providedColumns: Set<string>,
  values: Record<string, ParamPlaceholder>,
  paramsMap: Record<string, unknown>,
  userlandGenerators?: Map<string, () => unknown>,
): void {
  if (!userlandGenerators) {
    return;
  }

  for (const [columnName, column] of Object.entries(table.columns)) {
    // Skip if value already provided
    if (providedColumns.has(columnName)) {
      continue;
    }

    // Check for userland default
    if (column.default?.kind === 'userland') {
      const generator = userlandGenerators.get(column.default.name);
      if (generator) {
        // Use column name as the param name for generated values
        const paramName = `__generated_${columnName}`;
        values[columnName] = param(paramName);
        paramsMap[paramName] = generator();
      }
    }
  }
}

/**
 * Resolves userland defaults for a table, returning the generated column values.
 * This is a simpler helper for cases where you just need the generated values
 * without modifying existing maps.
 *
 * @param contract - The SQL contract
 * @param tableName - The name of the table
 * @param providedColumns - Set of column names already provided
 * @param userlandGenerators - Optional registry of userland generators
 * @returns Record of column name -> generated value
 */
export function generateUserlandDefaults(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  providedColumns: Set<string>,
  userlandGenerators?: Map<string, () => unknown>,
): Record<string, unknown> {
  if (!userlandGenerators) {
    return {};
  }

  const table = contract.storage.tables[tableName];
  if (!table) {
    return {};
  }

  const result: Record<string, unknown> = {};

  for (const [columnName, column] of Object.entries(table.columns)) {
    if (providedColumns.has(columnName)) {
      continue;
    }

    if (column.default?.kind === 'userland') {
      const generator = userlandGenerators.get(column.default.name);
      if (generator) {
        result[columnName] = generator();
      }
    }
  }

  return result;
}
