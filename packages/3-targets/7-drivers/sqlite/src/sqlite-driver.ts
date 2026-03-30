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
  #closed = false;

  constructor(path: string) {
    this.#path = path;
  }

  get state(): SqlDriverState {
    return this.#closed ? 'closed' : 'connected';
  }

  async connect(_binding: SqliteBinding): Promise<void> {}

  async acquireConnection(): Promise<SqlConnection> {
    const db = openConnection(this.#path);
    return new SqliteConnectionImpl(db);
  }

  async close(): Promise<void> {
    this.#closed = true;
  }

  async *execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const conn = await this.acquireConnection();
    try {
      for await (const row of conn.execute<Row>(request)) {
        yield row;
      }
    } finally {
      await conn.release();
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    const conn = await this.acquireConnection();
    try {
      // SqliteConnectionImpl always has explain defined
      return await conn.explain!(request);
    } finally {
      await conn.release();
    }
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    const conn = await this.acquireConnection();
    try {
      return await conn.query<Row>(sql, params);
    } finally {
      await conn.release();
    }
  }
}

export function createBoundDriverFromBinding(binding: SqliteBinding): SqlDriver<SqliteBinding> {
  return new SqliteBoundDriver(binding.path);
}
