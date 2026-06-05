import { DatabaseError, HttpResponseError, ValidationError, WebSocketError } from '@prisma/ppg';
import { SqlConnectionError, SqlQueryError } from '@prisma-next/sql-errors';

/**
 * Translate `@prisma/ppg` errors into the shared `SqlQueryError` /
 * `SqlConnectionError` vocabulary. PPG-specific shapes worth noting:
 * `DatabaseError` carries the Postgres `constraint` / `table` / `column` /
 * `detail` fields under `error.details` (not on the top-level object the way
 * `pg` exposes them); `ValidationError` (e.g. malformed connection string)
 * passes through unwrapped so the actionable shape stays visible to callers.
 */
export function normalizePpgError(error: unknown): SqlQueryError | SqlConnectionError | Error {
  if (error instanceof DatabaseError) {
    const options: {
      cause: Error;
      sqlState: string;
      constraint?: string;
      table?: string;
      column?: string;
      detail?: string;
    } = {
      cause: error,
      sqlState: error.code,
    };
    const constraint = error.details['constraint'];
    if (constraint !== undefined) options.constraint = constraint;
    const table = error.details['table'];
    if (table !== undefined) options.table = table;
    const column = error.details['column'];
    if (column !== undefined) options.column = column;
    const detail = error.details['detail'];
    if (detail !== undefined) options.detail = detail;
    return new SqlQueryError(error.message, options);
  }

  if (error instanceof WebSocketError) {
    return new SqlConnectionError(error.message, {
      cause: error,
      transient: isTransientWebSocketClosure(error.closureCode),
    });
  }

  if (error instanceof HttpResponseError) {
    return new SqlConnectionError(error.message, {
      cause: error,
      transient: error.status >= 500,
    });
  }

  if (error instanceof ValidationError) {
    return error;
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

// Per RFC 6455: only server-side / temporary closure codes are retryable.
// Protocol / policy / data-shape codes (1002, 1003, 1007, 1008, 1009, 1010)
// won't succeed on retry without the caller changing something, so they are
// non-transient. Unknown / missing codes are conservatively non-transient.
function isTransientWebSocketClosure(code: number | undefined): boolean {
  switch (code) {
    case 1006: // abnormal closure
    case 1011: // internal server error
    case 1012: // service restart
    case 1013: // try again later
    case 1014: // bad gateway
      return true;
    default:
      return false;
  }
}
