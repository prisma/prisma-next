import { SqlConnectionError, SqlQueryError } from '@prisma-next/sql-errors';

interface NodeSqliteError extends Error {
  readonly code: string;
  readonly errcode: number;
  readonly errstr?: string;
}

interface BunSqliteError extends Error {
  readonly errno: number;
  readonly byteOffset?: number;
}

function isNodeSqliteError(error: unknown): error is NodeSqliteError {
  if (!(error instanceof Error)) {
    return false;
  }
  const record = error as Record<string, unknown>;
  return (
    typeof record.code === 'string' &&
    record.code === 'ERR_SQLITE_ERROR' &&
    typeof record.errcode === 'number'
  );
}

function isBunSqliteError(error: unknown): error is BunSqliteError {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name !== 'SQLiteError') {
    return false;
  }
  const record = error as Record<string, unknown>;
  return typeof record.errno === 'number';
}

function isConnectionErrcode(errcode: number): boolean {
  // SQLite primary error codes, see sqlite3.h:
  // 14: SQLITE_CANTOPEN
  // 26: SQLITE_NOTADB
  // 10: SQLITE_IOERR
  // 23: SQLITE_AUTH
  // 13: SQLITE_FULL
  // 8:  SQLITE_READONLY
  return (
    errcode === 14 ||
    errcode === 26 ||
    errcode === 10 ||
    errcode === 23 ||
    errcode === 13 ||
    errcode === 8
  );
}

function isTransientErrcode(errcode: number): boolean {
  // 5: SQLITE_BUSY, 6: SQLITE_LOCKED, 10: SQLITE_IOERR
  // Note: node:sqlite returns extended errcodes as well (e.g. 2067 for UNIQUE constraint).
  return errcode === 5 || errcode === 6 || errcode === 10;
}

export function normalizeSqliteError(error: unknown): SqlQueryError | SqlConnectionError | Error {
  if (!(error instanceof Error)) {
    return new Error(String(error));
  }

  const errcode = isNodeSqliteError(error)
    ? error.errcode
    : isBunSqliteError(error)
      ? error.errno
      : undefined;
  if (errcode === undefined) {
    return error;
  }
  const sqlState = `SQLITE_${errcode}`;

  if (isConnectionErrcode(errcode)) {
    return new SqlConnectionError(error.message, {
      cause: error,
      transient: isTransientErrcode(errcode),
    });
  }

  return new SqlQueryError(error.message, {
    cause: error,
    sqlState,
  });
}
