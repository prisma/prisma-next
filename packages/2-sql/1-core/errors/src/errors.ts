export interface SqlDriverError<Kind extends string> {
  readonly kind: Kind;
}
/**
 * SQL query error for query-related failures (syntax errors, constraint violations, permissions).
 */
export class SqlQueryError extends Error implements SqlDriverError<'sql_query'> {
  static readonly ERROR_NAME = 'SqlQueryError' as const;
  readonly kind = 'sql_query' as const;
  readonly sqlState: string | undefined;
  readonly constraint: string | undefined;
  readonly table: string | undefined;
  readonly column: string | undefined;
  readonly detail: string | undefined;

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
    this.name = SqlQueryError.ERROR_NAME;
    this.sqlState = options?.sqlState;
    this.constraint = options?.constraint;
    this.table = options?.table;
    this.column = options?.column;
    this.detail = options?.detail;
  }

  /**
   * Type predicate to check if an error is a SqlQueryError.
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
 * SQL connection error (timeouts, connection resets, etc.).
 */
export class SqlConnectionError extends Error implements SqlDriverError<'sql_connection'> {
  static readonly ERROR_NAME = 'SqlConnectionError' as const;
  readonly kind = 'sql_connection' as const;
  readonly transient: boolean | undefined;

  constructor(
    message: string,
    options?: {
      readonly cause?: Error;
      readonly transient?: boolean;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = SqlConnectionError.ERROR_NAME;
    this.transient = options?.transient;
  }

  /**
   * Type predicate to check if an error is a SqlConnectionError.
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
