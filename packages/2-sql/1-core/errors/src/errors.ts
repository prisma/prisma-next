/**
 * SQL query error for query-related failures (syntax errors, constraint violations, permissions).
 * Normalized from driver-specific errors (e.g., Postgres SQLSTATE errors).
 */
export class SqlQueryError extends Error {
  readonly kind = 'sql_query' as const;
  readonly sqlState?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
  readonly detail?: string;

  constructor(
    message: string,
    options?: {
      readonly cause?: Error;
      readonly sqlState?: string;
      readonly constraint?: string;
      readonly table?: string;
      readonly column?: string;
      readonly detail?: string;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'SqlQueryError';
    this.sqlState = options?.sqlState;
    this.constraint = options?.constraint;
    this.table = options?.table;
    this.column = options?.column;
    this.detail = options?.detail;
  }

  /**
   * Type predicate to check if an error is a SqlQueryError.
   * Uses shape checking instead of instanceof to avoid issues with bundling/duplication.
   */
  static is(error: unknown): error is SqlQueryError {
    return (
      typeof error === 'object' &&
      error !== null &&
      Object.hasOwn(error, 'kind') &&
      (error as { kind: unknown }).kind === 'sql_query'
    );
  }
}

/**
 * SQL connection error for connection-related failures (timeouts, connection resets, etc.).
 * Normalized from driver-specific connection errors.
 */
export class SqlConnectionError extends Error {
  readonly kind = 'sql_connection' as const;
  readonly transient?: boolean;

  constructor(
    message: string,
    options?: {
      readonly cause?: Error;
      readonly transient?: boolean;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'SqlConnectionError';
    this.transient = options?.transient;
  }

  /**
   * Type predicate to check if an error is a SqlConnectionError.
   * Uses shape checking instead of instanceof to avoid issues with bundling/duplication.
   */
  static is(error: unknown): error is SqlConnectionError {
    return (
      typeof error === 'object' &&
      error !== null &&
      Object.hasOwn(error, 'kind') &&
      (error as { kind: unknown }).kind === 'sql_connection'
    );
  }
}
