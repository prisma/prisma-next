import { DatabaseError, HttpResponseError, ValidationError, WebSocketError } from '@prisma/ppg';
import { SqlConnectionError, SqlQueryError } from '@prisma-next/sql-errors';

/**
 * Translate a `@prisma/ppg` error into the shared `SqlQueryError` /
 * `SqlConnectionError` vocabulary used across SQL drivers.
 *
 * - `DatabaseError` (PostgreSQL wire error with a SQLSTATE code) → `SqlQueryError`.
 *   PPG carries the conventional Postgres error fields (`constraint`, `table`,
 *   `column`, `detail`, …) under `details: Record<string, string>` rather than
 *   on the top-level error object like `pg` does.
 * - `WebSocketError` (transport failure) → `SqlConnectionError`. The closure
 *   code distinguishes normal closures (1000, 1001) from abnormal ones; only
 *   abnormal codes are marked transient.
 * - `HttpResponseError` (HTTP-side failure during initial handshake) →
 *   `SqlConnectionError`. 5xx is transient, 4xx is not.
 * - `ValidationError` (programmer error such as a malformed connection string)
 *   passes through unchanged. Wrapping it would obscure the actionable shape.
 * - Anything else: pass through if it's already an `Error`, otherwise wrap.
 *
 * The original error is preserved via `Error.cause` so stack traces and any
 * PPG-specific metadata stay reachable to consumers.
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

/**
 * Best-effort transient classification for WebSocket closures.
 *
 * Codes 1000 (normal) and 1001 (going away) are clean closures and should not
 * normally surface as errors; treat them as non-transient if we ever see them
 * here. Any other observed code — or no code at all (`undefined` falls through
 * to `false` since we lack the signal to claim retryability) — is treated as
 * non-transient unless explicitly known.
 *
 * The conservative default here is "not transient": callers that retry on
 * transient errors must have evidence the failure is recoverable. We expand
 * this set as PPG's closure-code semantics become observed.
 */
function isTransientWebSocketClosure(code: number | undefined): boolean {
  if (code === undefined) {
    return false;
  }
  if (code === 1000 || code === 1001) {
    return false;
  }
  // 1006 (abnormal closure), 1011 (server error), 1012/1013 (service
  // restart / try again later), 1014 (bad gateway) and similar are
  // generally retryable on the next attempt.
  return true;
}
