import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';

export function mapFieldToColumn(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  fieldName: string,
): string {
  return contract.mappings.fieldToColumn?.[modelName]?.[fieldName] ?? fieldName;
}

export function mapFieldsToColumns(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  fieldNames: readonly string[],
): string[] {
  const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};
  return fieldNames.map((fieldName) => fieldToColumn[fieldName] ?? fieldName);
}

export function mapCursorValuesToColumns(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  cursorValues: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};
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
