import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { AnyColumnBuilder, ParamPlaceholder } from '../types';

/**
 * Helper to extract columnMeta from a ColumnBuilder.
 * Returns StorageColumn if present, undefined otherwise.
 * AnyColumnBuilder is a union that includes types with columnMeta property,
 * so we can safely access it after checking for existence.
 */
export function getColumnMeta(expr: AnyColumnBuilder): StorageColumn | undefined {
  // AnyColumnBuilder includes AnyColumnBuilderBase which has columnMeta: StorageColumn
  // and ColumnBuilder which has columnMeta: ColumnMeta extends StorageColumn
  // TypeScript should narrow the type after the 'in' check
  if ('columnMeta' in expr) {
    return expr.columnMeta;
  }
  return undefined;
}

/**
 * Type predicate to check if a value is a ParamPlaceholder.
 */
export function isParamPlaceholder(value: unknown): value is ParamPlaceholder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind: unknown }).kind === 'param-placeholder' &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string'
  );
}
