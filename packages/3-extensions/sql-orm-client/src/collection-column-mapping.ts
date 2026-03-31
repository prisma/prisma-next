import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { getFieldToColumnMap, resolveFieldToColumn } from './collection-contract';

export function mapFieldToColumn(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  fieldName: string,
): string {
  return resolveFieldToColumn(contract, modelName, fieldName);
}

export function mapFieldsToColumns(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  fieldNames: readonly string[],
): string[] {
  const fieldToColumn = getFieldToColumnMap(contract, modelName);
  return fieldNames.map((fieldName) => fieldToColumn[fieldName] ?? fieldName);
}

export function mapCursorValuesToColumns(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  cursorValues: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const fieldToColumn = getFieldToColumnMap(contract, modelName);
  const mappedCursor: Record<string, unknown> = {};

  for (const [fieldName, value] of Object.entries(cursorValues)) {
    if (value === undefined) {
      continue;
    }

    const columnName = fieldToColumn[fieldName] ?? fieldName;
    mappedCursor[columnName] = value;
  }

  return mappedCursor;
}
