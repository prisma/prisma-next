/**
 * Shared SQL utility functions for the Postgres target.
 *
 * These functions handle safe SQL identifier and literal escaping
 * with security validations to prevent injection and encoding issues.
 *
 * They live in `target-postgres` because both the control adapter (used at
 * emit time) and the runtime adapter (used at execute time) need the same
 * escaping/validation behavior, and the target package is the natural shared
 * home that both adapters can depend on without crossing planes.
 */

export class SqlEscapeError extends Error {
  constructor(
    message: string,
    public readonly value: string,
    public readonly kind: 'identifier' | 'literal',
  ) {
    super(message);
    this.name = 'SqlEscapeError';
  }
}

const MAX_IDENTIFIER_LENGTH = 63;

/**
 * Validates and quotes a PostgreSQL identifier (table, column, type, schema names).
 *
 * Security validations:
 * - Rejects null bytes which could cause truncation or unexpected behavior
 * - Rejects empty identifiers
 * - Warns on identifiers exceeding PostgreSQL's 63-character limit
 *
 * @throws {SqlEscapeError} If the identifier contains null bytes or is empty
 */
export function quoteIdentifier(identifier: string): string {
  if (identifier.length === 0) {
    throw new SqlEscapeError('Identifier cannot be empty', identifier, 'identifier');
  }
  if (identifier.includes('\0')) {
    throw new SqlEscapeError(
      'Identifier cannot contain null bytes',
      identifier.replace(/\0/g, '\\0'),
      'identifier',
    );
  }
  if (identifier.length > MAX_IDENTIFIER_LENGTH) {
    console.warn(
      `Identifier "${identifier.slice(0, 20)}..." exceeds PostgreSQL's ${MAX_IDENTIFIER_LENGTH}-character limit and will be truncated`,
    );
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Escapes a string literal for safe use in SQL statements.
 *
 * Security validations:
 * - Rejects null bytes which could cause truncation or unexpected behavior
 *
 * Note: This assumes PostgreSQL's `standard_conforming_strings` is ON (default since PG 9.1).
 * Backslashes are treated as literal characters, not escape sequences.
 *
 * @throws {SqlEscapeError} If the value contains null bytes
 */
export function escapeLiteral(value: string): string {
  if (value.includes('\0')) {
    throw new SqlEscapeError(
      'Literal value cannot contain null bytes',
      value.replace(/\0/g, '\\0'),
      'literal',
    );
  }
  return value.replace(/'/g, "''");
}

/**
 * Builds a qualified name (schema.object) with proper quoting.
 */
export function qualifyName(schemaName: string, objectName: string): string {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(objectName)}`;
}

/**
 * Validates that an enum value doesn't exceed PostgreSQL's label length limit.
 *
 * PostgreSQL enum labels have a maximum length of NAMEDATALEN-1 (63 bytes by default).
 * Unlike identifiers, enum labels that exceed this limit cause an error rather than
 * silent truncation.
 *
 * @param value - The enum value to validate
 * @param enumTypeName - Name of the enum type (for error messages)
 * @throws {SqlEscapeError} If the value exceeds the maximum length
 */
export function validateEnumValueLength(value: string, enumTypeName: string): void {
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    throw new SqlEscapeError(
      `Enum value "${value.slice(0, 20)}..." for type "${enumTypeName}" exceeds PostgreSQL's ` +
        `${MAX_IDENTIFIER_LENGTH}-character label limit`,
      value,
      'literal',
    );
  }
}
