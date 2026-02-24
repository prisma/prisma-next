import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CollectionContext, RuntimeConnection, RuntimeScope } from './types';

export interface RowEnvelope {
  readonly raw: Record<string, unknown>;
  readonly mapped: Record<string, unknown>;
}

export function augmentSelectionForJoinColumns(
  selectedFields: readonly string[] | undefined,
  requiredColumns: readonly string[],
): {
  selectedForQuery: readonly string[] | undefined;
  hiddenColumns: readonly string[];
} {
  if (!selectedFields) {
    return {
      selectedForQuery: selectedFields,
      hiddenColumns: [],
    };
  }

  const hiddenColumns = requiredColumns.filter((column) => !selectedFields.includes(column));
  if (hiddenColumns.length === 0) {
    return {
      selectedForQuery: selectedFields,
      hiddenColumns: [],
    };
  }

  return {
    selectedForQuery: [...selectedFields, ...hiddenColumns],
    hiddenColumns,
  };
}

export function stripHiddenMappedFields(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  mapped: Record<string, unknown>,
  hiddenColumns: readonly string[],
): void {
  if (hiddenColumns.length === 0) {
    return;
  }

  const columnToField = contract.mappings.columnToField?.[tableName] ?? {};
  for (const hiddenColumn of hiddenColumns) {
    const fieldName = columnToField[hiddenColumn] ?? hiddenColumn;
    delete mapped[fieldName];
  }
}

export function createRowEnvelope(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  raw: Record<string, unknown>,
): RowEnvelope {
  return {
    raw,
    mapped: mapStorageRowToModelFields(contract, tableName, raw),
  };
}

export function mapStorageRowToModelFields(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const columnToField = contract.mappings.columnToField?.[tableName];
  if (!columnToField) {
    return { ...row };
  }

  const mapped: Record<string, unknown> = {};
  for (const [columnName, value] of Object.entries(row)) {
    mapped[columnToField[columnName] ?? columnName] = value;
  }
  return mapped;
}

export function mapModelDataToStorageRow(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};
  const mapped: Record<string, unknown> = {};
  for (const [fieldName, value] of Object.entries(row)) {
    if (value === undefined) {
      continue;
    }
    const columnName = fieldToColumn[fieldName] ?? fieldName;
    mapped[columnName] = value;
  }
  return mapped;
}

export function mapResultRows<TIn, TOut>(
  result: AsyncIterableResult<TIn>,
  mapper: (value: TIn) => TOut,
): AsyncIterableResult<TOut> {
  const generator = async function* (): AsyncGenerator<TOut, void, unknown> {
    for await (const value of result) {
      yield mapper(value);
    }
  };
  return new AsyncIterableResult(generator());
}

export async function acquireRuntimeScope(
  runtime: CollectionContext<SqlContract<SqlStorage>>['runtime'],
): Promise<{
  scope: RuntimeScope;
  release?: () => Promise<void>;
}> {
  if (typeof runtime.connection !== 'function') {
    return { scope: runtime };
  }

  const connection = await runtime.connection();
  if (typeof connection.release === 'function') {
    return {
      scope: connection,
      release: () => (connection as RuntimeConnection).release?.() ?? Promise.resolve(),
    };
  }

  return { scope: connection };
}
