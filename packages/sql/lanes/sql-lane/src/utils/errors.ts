import { planInvalid } from '@prisma-next/plan';

export function errorAliasPathEmpty(): never {
  throw planInvalid('Alias path cannot be empty');
}

export function errorAliasCollision(path: string[], alias: string, existingPath?: string[]): never {
  throw planInvalid(
    `Alias collision: path ${path.join('.')} would generate alias "${alias}" which conflicts with path ${existingPath?.join('.') ?? 'unknown'}`,
  );
}

export function errorLimitMustBeNonNegativeInteger(): never {
  throw planInvalid('Limit must be a non-negative integer');
}

export function errorChildProjectionMustBeSpecified(): never {
  throw planInvalid('Child projection must be specified');
}

export function errorIncludeRequiresCapabilities(): never {
  throw planInvalid('includeMany requires lateral and jsonAgg capabilities');
}

export function errorIncludeCapabilitiesNotTrue(): never {
  throw planInvalid('includeMany requires lateral and jsonAgg capabilities to be true');
}

export function errorUnknownTable(tableName: string): never {
  throw planInvalid(`Unknown table ${tableName}`);
}

export function errorSelfJoinNotSupported(): never {
  throw planInvalid('Self-joins are not supported in MVP');
}

export function errorChildProjectionEmpty(): never {
  throw planInvalid('Child projection must not be empty');
}

export function errorIncludeAliasCollision(alias: string, type: 'projection' | 'include'): never {
  throw planInvalid(
    `Alias collision: include alias "${alias}" conflicts with existing ${type} alias`,
  );
}

export function errorMissingColumnForAlias(alias: string, index: number): never {
  throw planInvalid(`Missing column for alias ${alias ?? 'unknown'} at index ${index}`);
}

export function errorMissingAlias(index: number): never {
  throw planInvalid(`Missing alias at index ${index}`);
}

export function errorInvalidColumnForAlias(alias: string, index: number): never {
  throw planInvalid(`Invalid column for alias ${alias} at index ${index}`);
}

export function errorFromMustBeCalled(): never {
  throw planInvalid('from() must be called before building a query');
}

export function errorSelectMustBeCalled(): never {
  throw planInvalid('select() must be called before build()');
}

export function errorMissingParameter(paramName: string): never {
  throw planInvalid(`Missing value for parameter ${paramName}`);
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

export function errorReturningRequiresCapability(): never {
  throw planInvalid('returning() requires returning capability');
}

export function errorReturningCapabilityNotTrue(): never {
  throw planInvalid('returning() requires returning capability to be true');
}

export function errorUnknownColumn(columnName: string, tableName: string): never {
  throw planInvalid(`Unknown column ${columnName} in table ${tableName}`);
}

export function errorWhereMustBeCalledForUpdate(): never {
  throw planInvalid('where() must be called before building an UPDATE query');
}

export function errorFailedToBuildWhereClause(): never {
  throw planInvalid('Failed to build WHERE clause');
}

export function errorWhereMustBeCalledForDelete(): never {
  throw planInvalid('where() must be called before building a DELETE query');
}
