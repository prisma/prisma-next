import type { Contract } from '@prisma-next/contract/types';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  findModelNameForTable,
  getColumnToFieldMap,
  getFieldToColumnMap,
  type PolymorphismInfo,
} from './collection-contract';
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
  contract: Contract<SqlStorage>,
  tableName: string,
  mapped: Record<string, unknown>,
  hiddenColumns: readonly string[],
  resolvedModelName?: string,
): void {
  if (hiddenColumns.length === 0) {
    return;
  }

  const modelName = resolvedModelName ?? findModelNameForTable(contract, tableName) ?? tableName;
  const columnToField = getColumnToFieldMap(contract, modelName);
  for (const hiddenColumn of hiddenColumns) {
    const fieldName = columnToField[hiddenColumn] ?? hiddenColumn;
    delete mapped[fieldName];
  }
}

export function createRowEnvelope(
  contract: Contract<SqlStorage>,
  tableName: string,
  raw: Record<string, unknown>,
  modelName?: string,
): RowEnvelope {
  return {
    raw,
    mapped: mapStorageRowToModelFields(contract, tableName, raw, modelName),
  };
}

export function mapStorageRowToModelFields(
  contract: Contract<SqlStorage>,
  tableName: string,
  row: Record<string, unknown>,
  resolvedModelName?: string,
): Record<string, unknown> {
  const modelName = resolvedModelName ?? findModelNameForTable(contract, tableName);
  if (!modelName) {
    return { ...row };
  }

  const columnToField = getColumnToFieldMap(contract, modelName);
  if (Object.keys(columnToField).length === 0) {
    return { ...row };
  }

  const mapped: Record<string, unknown> = {};
  for (const [columnName, value] of Object.entries(row)) {
    mapped[columnToField[columnName] ?? columnName] = value;
  }
  return mapped;
}

const mergedColumnToFieldCache = new WeakMap<object, Map<string, Record<string, string>>>();

function getMergedColumnToFieldMap(
  contract: Contract<SqlStorage>,
  baseModelName: string,
  variantModelName: string,
): Record<string, string> {
  const cacheKey = `${baseModelName}:${variantModelName}`;
  let perContract = mergedColumnToFieldCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    mergedColumnToFieldCache.set(contract, perContract);
  }
  const cached = perContract.get(cacheKey);
  if (cached) return cached;

  const baseMap = getColumnToFieldMap(contract, baseModelName);
  const variantMap = getColumnToFieldMap(contract, variantModelName);
  const merged = { ...baseMap, ...variantMap };
  perContract.set(cacheKey, merged);
  return merged;
}

export function mapPolymorphicRow(
  contract: Contract<SqlStorage>,
  baseModelName: string,
  polyInfo: PolymorphismInfo,
  row: Record<string, unknown>,
  variantName?: string,
): Record<string, unknown> {
  const variant = variantName
    ? polyInfo.variants.get(variantName)
    : polyInfo.variantsByValue.get(row[polyInfo.discriminatorColumn] as string);

  if (!variant) {
    const baseMap = getColumnToFieldMap(contract, baseModelName);
    const mapped: Record<string, unknown> = {};
    for (const [col, val] of Object.entries(row)) {
      if (col in baseMap) {
        mapped[baseMap[col]!] = val;
      }
    }
    return mapped;
  }

  const mergedMap = getMergedColumnToFieldMap(contract, baseModelName, variant.modelName);
  const mapped: Record<string, unknown> = {};
  for (const [col, val] of Object.entries(row)) {
    if (col in mergedMap) {
      mapped[mergedMap[col]!] = val;
    }
  }
  return mapped;
}

export function mapModelDataToStorageRow(
  contract: Contract<SqlStorage>,
  modelName: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const fieldToColumn = getFieldToColumnMap(contract, modelName);
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
  runtime: CollectionContext<Contract<SqlStorage>>['runtime'],
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
