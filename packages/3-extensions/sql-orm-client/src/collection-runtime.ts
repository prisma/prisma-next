import type { Contract } from '@prisma-next/contract/types';
import { AsyncIterableResult } from '@prisma-next/runtime-executor';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  getColumnToFieldMap,
  getCompleteColumnToFieldMap,
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
  modelName: string,
  mapped: Record<string, unknown>,
  hiddenColumns: readonly string[],
): void {
  if (hiddenColumns.length === 0) {
    return;
  }

  const columnToField = getColumnToFieldMap(contract, modelName);
  for (const hiddenColumn of hiddenColumns) {
    const fieldName = columnToField[hiddenColumn] ?? hiddenColumn;
    delete mapped[fieldName];
  }
}

export function createRowEnvelope(
  contract: Contract<SqlStorage>,
  modelName: string,
  raw: Record<string, unknown>,
): RowEnvelope {
  return {
    raw,
    mapped: mapStorageRowToModelFields(contract, modelName, raw),
  };
}

export function mapStorageRowToModelFields(
  contract: Contract<SqlStorage>,
  modelName: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
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
  variantTable: string | undefined,
): Record<string, string> {
  const cacheKey = `${baseModelName}:${variantModelName}`;
  let perContract = mergedColumnToFieldCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    mergedColumnToFieldCache.set(contract, perContract);
  }
  const cached = perContract.get(cacheKey);
  if (cached) return cached;

  const baseMap = getCompleteColumnToFieldMap(contract, baseModelName);
  const variantMap = getCompleteColumnToFieldMap(contract, variantModelName);

  const merged: Record<string, string> = { ...baseMap };
  for (const [col, field] of Object.entries(variantMap)) {
    if (variantTable) {
      merged[`${variantTable}__${col}`] = field;
    } else {
      merged[col] = field;
    }
  }

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
    const baseMap = getCompleteColumnToFieldMap(contract, baseModelName);
    const mapped: Record<string, unknown> = {};
    for (const [col, val] of Object.entries(row)) {
      const field = baseMap[col];
      if (field !== undefined) {
        mapped[field] = val;
      }
    }
    return mapped;
  }

  const mtiTable = variant.strategy === 'mti' ? variant.table : undefined;
  const mergedMap = getMergedColumnToFieldMap(contract, baseModelName, variant.modelName, mtiTable);
  const mapped: Record<string, unknown> = {};
  for (const [col, val] of Object.entries(row)) {
    const field = mergedMap[col];
    if (field !== undefined) {
      mapped[field] = val;
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
