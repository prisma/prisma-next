import { SqlConnectionError, SqlQueryError } from '@prisma-next/sql-errors';

/**
 * Postgres error shape from the pg library.
 *
 * Note: The pg library doesn't export a DatabaseError type or interface, but errors
 * thrown by pg.query() and pg.Client have this shape at runtime. We define this
 * interface to match the actual runtime structure documented in the pg library
 * (https://github.com/brianc/node-postgres/blob/master/packages/pg/lib/errors.js).
 *
 * The @types/pg package also doesn't provide comprehensive error type definitions,
 * so we define our own interface based on the runtime error properties.
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
 * Type predicate to check if an error is a Postgres error from the pg library.
 * Postgres errors have a `code` property that distinguishes them from other errors.
 */
export function isPostgresError(error: unknown): error is PostgresError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string';
}

/**
 * Checks if an error is an "already connected" error from pg.Client.connect().
 * When calling connect() on an already-connected client, pg throws an error that can be safely ignored.
 */
export function isAlreadyConnectedError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes('already') && message.includes('connected');
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
    // isPostgresSqlState ensures code is defined and is a valid SQLSTATE
    // biome-ignore lint/style/noNonNullAssertion: isPostgresSqlState guarantees code is defined
    const sqlState = pgError.code!;
    const options: {
      cause: Error;
      sqlState: string;
      constraint?: string;
      table?: string;
      column?: string;
      detail?: string;
    } = {
      cause: error,
      sqlState,
    };
    if (pgError.constraint !== undefined) {
      options.constraint = pgError.constraint;
    }
    if (pgError.table !== undefined) {
      options.table = pgError.table;
    }
    if (pgError.column !== undefined) {
      options.column = pgError.column;
    }
    if (pgError.detail !== undefined) {
      options.detail = pgError.detail;
    }
    throw new SqlQueryError(error.message, options);
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
