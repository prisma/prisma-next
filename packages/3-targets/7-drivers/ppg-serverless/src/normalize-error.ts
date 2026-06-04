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

// Conservative: a missing or unknown code is non-transient (callers retrying
// on `transient: true` must have evidence the failure is recoverable). 1000
// (normal) and 1001 (going away) are clean closures; treat as non-transient
// if seen as errors. Anything else (1006 abnormal, 1011 server, 1012/1013
// restart/try-again-later, 1014 bad gateway, …) is retryable.
function isTransientWebSocketClosure(code: number | undefined): boolean {
  if (code === undefined) return false;
  if (code === 1000 || code === 1001) return false;
  return true;
}
