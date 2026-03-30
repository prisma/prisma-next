import type { SQLInputValue } from 'node:sqlite';
import { DatabaseSync } from 'node:sqlite';
import type {
  SqlConnection,
  SqlDriver,
  SqlDriverState,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlQueryResult,
  SqlTransaction,
} from '@prisma-next/sql-relational-core/ast';
import { normalizeSqliteError } from './normalize-error';

export type SqliteBinding = { readonly kind: 'path'; readonly path: string };

function toSqliteParams(params: readonly unknown[] | undefined): SQLInputValue[] {
  return (params ?? []) as SQLInputValue[];
}

function openConnection(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

class SqliteConnectionImpl implements SqlConnection {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  async *execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    try {
      const stmt = this.#db.prepare(request.sql);
      for (const row of stmt.iterate(...toSqliteParams(request.params))) {
        yield row as Row;
      }
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    try {
      const stmt = this.#db.prepare(`EXPLAIN QUERY PLAN ${request.sql}`);
      const rows = stmt.all(...toSqliteParams(request.params)) as ReadonlyArray<
        Record<string, unknown>
      >;
      return { rows };
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    try {
      const stmt = this.#db.prepare(sql);
      const rows = stmt.all(...toSqliteParams(params)) as Row[];
      return { rows };
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async beginTransaction(): Promise<SqlTransaction> {
    this.#db.exec('BEGIN');
    return new SqliteTransactionImpl(this.#db);
  }

  async release(): Promise<void> {
    this.#db.close();
  }
}

class SqliteTransactionImpl implements SqlTransaction {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  async *execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    try {
      const stmt = this.#db.prepare(request.sql);
      for (const row of stmt.iterate(...toSqliteParams(request.params))) {
        yield row as Row;
      }
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    try {
      const stmt = this.#db.prepare(`EXPLAIN QUERY PLAN ${request.sql}`);
      const rows = stmt.all(...toSqliteParams(request.params)) as ReadonlyArray<
        Record<string, unknown>
      >;
      return { rows };
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    try {
      const stmt = this.#db.prepare(sql);
      const rows = stmt.all(...toSqliteParams(params)) as Row[];
      return { rows };
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async commit(): Promise<void> {
    try {
      this.#db.exec('COMMIT');
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async rollback(): Promise<void> {
    try {
      this.#db.exec('ROLLBACK');
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }
}

export class SqliteBoundDriver implements SqlDriver<SqliteBinding> {
  readonly #path: string;
  // REVIEW: do we need primary DB for this? Can't we just always acquire a new connection? in execute/explain/query ?
  readonly #primary: DatabaseSync;
  #closed = false;

  constructor(path: string) {
    this.#path = path;
    this.#primary = openConnection(path);
  }

  get state(): SqlDriverState {
    return this.#closed ? 'closed' : 'connected';
  }

  async connect(_binding: SqliteBinding): Promise<void> {
    // Already bound at construction time
  }

  async acquireConnection(): Promise<SqlConnection> {
    const db = openConnection(this.#path);
    return new SqliteConnectionImpl(db);
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#primary.close();
  }

  async *execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    try {
      const stmt = this.#primary.prepare(request.sql);
      for (const row of stmt.iterate(...toSqliteParams(request.params))) {
        yield row as Row;
      }
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    try {
      const stmt = this.#primary.prepare(`EXPLAIN QUERY PLAN ${request.sql}`);
      const rows = stmt.all(...toSqliteParams(request.params)) as ReadonlyArray<
        Record<string, unknown>
      >;
      return { rows };
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    try {
      const stmt = this.#primary.prepare(sql);
      const rows = stmt.all(...toSqliteParams(params)) as Row[];
      return { rows };
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }
}

export function createBoundDriverFromBinding(binding: SqliteBinding): SqlDriver<SqliteBinding> {
  return new SqliteBoundDriver(binding.path);
}
