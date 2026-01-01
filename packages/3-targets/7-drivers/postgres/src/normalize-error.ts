import { SqlConnectionError, SqlQueryError } from '@prisma-next/sql-errors';

/**
 * Postgres error shape from the pg library.
 */
interface PostgresError extends Error {
  readonly code?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly position?: string;
  readonly internalPosition?: string;
  readonly internalQuery?: string;
  readonly where?: string;
  readonly schema?: string;
  readonly file?: string;
  readonly line?: string;
  readonly routine?: string;
}

/**
 * Checks if an error is a connection-related error.
 */
function isConnectionError(error: Error): boolean {
  const code = (error as { code?: string }).code;
  if (code) {
    // Node.js error codes for connection issues
    if (
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'EHOSTUNREACH'
    ) {
      return true;
    }
  }

  // Check error message for connection-related strings
  const message = error.message.toLowerCase();
  if (
    message.includes('connection terminated') ||
    message.includes('connection closed') ||
    message.includes('connection refused') ||
    message.includes('connection timeout') ||
    message.includes('connection reset')
  ) {
    return true;
  }

  return false;
}

/**
 * Checks if a connection error is transient (might succeed on retry).
 */
function isTransientConnectionError(error: Error): boolean {
  const code = (error as { code?: string }).code;
  if (code) {
    // Timeouts and connection resets are often transient
    if (code === 'ETIMEDOUT' || code === 'ECONNRESET') {
      return true;
    }
    // Connection refused is usually not transient (server is down)
    if (code === 'ECONNREFUSED') {
      return false;
    }
  }

  const message = error.message.toLowerCase();
  if (message.includes('timeout') || message.includes('connection reset')) {
    return true;
  }

  return false;
}

/**
 * Checks if an error code is a Postgres SQLSTATE (5-character alphanumeric code).
 * SQLSTATE codes are standardized SQL error codes (e.g., '23505' for unique violation).
 */
function isPostgresSqlState(code: string | undefined): boolean {
  if (!code) {
    return false;
  }
  // Postgres SQLSTATE codes are 5-character alphanumeric strings
  // Examples: '23505' (unique violation), '42501' (insufficient privilege), '42601' (syntax error)
  return /^[A-Z0-9]{5}$/.test(code);
}

/**
 * Normalizes a Postgres error into a SQL-shared error type.
 *
 * - Postgres SQLSTATE errors (5-char codes like '23505') → SqlQueryError
 * - Connection errors (ECONNRESET, ETIMEDOUT, etc.) → SqlConnectionError
 * - Unknown errors → re-thrown as-is
 *
 * The original error is preserved via Error.cause to maintain stack traces.
 *
 * @param error - The error to normalize (typically from pg library)
 * @throws SqlQueryError for query-related failures
 * @throws SqlConnectionError for connection-related failures
 * @throws The original error if it cannot be normalized
 */
export function normalizePgError(error: unknown): never {
  if (!(error instanceof Error)) {
    throw error;
  }

  const pgError = error as PostgresError;

  // Check for Postgres SQLSTATE (query errors)
  if (isPostgresSqlState(pgError.code)) {
    throw new SqlQueryError(error.message, {
      cause: error,
      sqlState: pgError.code,
      constraint: pgError.constraint,
      table: pgError.table,
      column: pgError.column,
      detail: pgError.detail,
    });
  }

  // Check for connection errors
  if (isConnectionError(error)) {
    throw new SqlConnectionError(error.message, {
      cause: error,
      transient: isTransientConnectionError(error),
    });
  }

  // Unknown error - rethrow as-is to preserve original error and stack trace
  throw error;
}
