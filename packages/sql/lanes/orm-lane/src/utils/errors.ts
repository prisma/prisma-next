import { planInvalid } from '@prisma-next/plan';
import type { StorageColumn } from '@prisma-next/sql-contract/types';

export function errorModelNotFound(modelName: string): never {
  throw planInvalid(`Model ${modelName} not found in mappings`);
}

export function errorTableNotFound(tableName: string): never {
  throw planInvalid(`Table ${tableName} not found in schema`);
}

export function errorUnknownTable(tableName: string): never {
  throw planInvalid(`Unknown table ${tableName}`);
}

export function errorUnknownColumn(columnName: string, tableName: string): never {
  throw planInvalid(`Unknown column ${columnName} in table ${tableName}`);
}

export function errorMissingParameter(paramName: string): never {
  throw planInvalid(`Missing value for parameter ${paramName}`);
}

export function errorAliasPathEmpty(): never {
  throw planInvalid('Alias path cannot be empty');
}

export function errorAliasCollision(path: string[], alias: string, existingPath?: string[]): never {
  throw planInvalid(
    `Alias collision: path ${path.join('.')} would generate alias "${alias}" which conflicts with path ${existingPath?.join('.') ?? 'unknown'}`,
  );
}

export function errorInvalidProjectionValue(path: string[]): never {
  throw planInvalid(
    `Invalid projection value at path ${path.join('.')}: expected ColumnBuilder or nested object`,
  );
}

export function errorIncludeAliasNotFound(alias: string): never {
  throw planInvalid(
    `Include alias "${alias}" not found. Did you call includeMany() with alias "${alias}"?`,
  );
}

export function errorInvalidProjectionKey(key: string): never {
  throw planInvalid(
    `Invalid projection value at key "${key}": expected ColumnBuilder, boolean true (for includes), or nested object`,
  );
}

export function errorProjectionEmpty(): never {
  throw planInvalid('select() requires at least one column or include');
}

export function errorCreateRequiresFields(): never {
  throw planInvalid('create() requires at least one field');
}

export function errorUpdateRequiresFields(): never {
  throw planInvalid('update() requires at least one field');
}

export function errorIncludeRequiresCapabilities(): never {
  throw planInvalid('includeMany requires lateral and jsonAgg capabilities');
}

export function errorIncludeCapabilitiesNotTrue(): never {
  throw planInvalid('includeMany requires lateral and jsonAgg capabilities to be true');
}

export function errorMultiColumnJoinsNotSupported(): never {
  throw planInvalid('Multi-column joins in includes are not yet supported');
}

export function errorJoinColumnsMustBeDefined(): never {
  throw planInvalid('Join columns must be defined');
}

export function errorColumnNotFound(columnName: string, tableName: string): never {
  throw planInvalid(`Column ${columnName} not found in table ${tableName}`);
}

export function errorChildProjectionMustBeSpecified(): never {
  throw planInvalid('Child projection must be specified');
}

export function errorChildProjectionEmpty(): never {
  throw planInvalid('Child projection must not be empty after filtering boolean values');
}

export function errorMissingAlias(index: number): never {
  throw planInvalid(`Missing alias at index ${index}`);
}

export function errorMissingColumn(alias: string, index: number): never {
  throw planInvalid(`Missing column for alias ${alias} at index ${index}`);
}

export function errorInvalidColumn(alias: string, index: number): never {
  throw planInvalid(`Invalid column for alias ${alias} at index ${index}`);
}

export function errorRelationNotFound(relationName: string, modelName: string): never {
  throw planInvalid(`Relation ${relationName} not found on model ${modelName}`);
}

export function errorFailedToBuildWhereClause(): never {
  throw planInvalid('Failed to build WHERE clause');
}

export function assertColumnExists(
  columnMeta: StorageColumn | undefined,
  columnName: string,
  tableName: string,
): asserts columnMeta is StorageColumn {
  if (!columnMeta) {
    errorUnknownColumn(columnName, tableName);
  }
}

export function assertParameterExists(
  paramsMap: Record<string, unknown>,
  paramName: string,
): unknown {
  if (!Object.hasOwn(paramsMap, paramName)) {
    errorMissingParameter(paramName);
  }
  return paramsMap[paramName];
}
