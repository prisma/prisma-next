/**
 * Shared SQL utility functions for the SQLite adapter.
 *
 * These functions handle safe SQL identifier and literal escaping
 * with security validations to prevent injection and encoding issues.
 */

/**
 * Error thrown when an invalid SQL identifier or literal is detected.
 * Boundary layers map this to structured envelopes.
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

/**
 * Practical identifier length limit used for diagnostics.
 *
 * SQLite supports long identifiers; this is primarily a guardrail for accidental abuse and
 * to keep parity with other targets that truncate around 63.
 */
const MAX_IDENTIFIER_LENGTH = 63;

/**
 * Validates and quotes a SQLite identifier (table, column names).
 *
 * Security validations:
 * - Rejects null bytes which could cause truncation or unexpected behavior
 * - Rejects empty identifiers
 * - Warns on very long identifiers (diagnostic only)
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
  // Diagnostic-only warning for unusually long identifiers.
  if (identifier.length > MAX_IDENTIFIER_LENGTH) {
    console.warn(
      `Identifier "${identifier.slice(0, 20)}..." exceeds ${MAX_IDENTIFIER_LENGTH} characters`,
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
 * Builds a qualified name (db.table) with proper quoting.
 *
 * In SQLite this is primarily used for attached databases, not schemas.
 */
export function qualifyName(schemaName: string, objectName: string): string {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(objectName)}`;
}
