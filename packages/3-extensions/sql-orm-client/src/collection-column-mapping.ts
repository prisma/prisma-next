import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { getFieldToColumnMap } from './collection-contract';

export function mapFieldsToColumns(
  contract: Contract<SqlStorage>,
  modelName: string,
  fieldNames: readonly string[],
): string[] {
  const fieldToColumn = getFieldToColumnMap(contract, modelName);
  return fieldNames.map((fieldName) => fieldToColumn[fieldName] ?? fieldName);
}

export function mapCursorValuesToColumns(
  contract: Contract<SqlStorage>,
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
