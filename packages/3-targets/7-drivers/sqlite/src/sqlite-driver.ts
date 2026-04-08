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
  try {
    const db = new DatabaseSync(path);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    return db;
  } catch (error) {
    throw normalizeSqliteError(error);
  }
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
    try {
      this.#db.exec('BEGIN');
      return new SqliteTransactionImpl(this.#db);
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async release(): Promise<void> {
    try {
      this.#db.close();
    } catch (error) {
      throw normalizeSqliteError(error);
    }
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

interface ConnectedState {
  readonly kind: 'connected';
  readonly path: string;
  readonly conn: SqliteConnectionImpl;
}

type DriverState = { readonly kind: 'unbound' } | ConnectedState | { readonly kind: 'closed' };

export class SqliteBoundDriver implements SqlDriver<SqliteBinding> {
  #state: DriverState;

  constructor(initialState?: ConnectedState) {
    this.#state = initialState ?? { kind: 'unbound' };
  }

  #requireConnected(): ConnectedState {
    if (this.#state.kind !== 'connected') {
      throw new Error('SQLite driver not connected. Call connect(binding) first.');
    }
    return this.#state;
  }

  get state(): SqlDriverState {
    return this.#state.kind;
  }

  async connect(binding: SqliteBinding): Promise<void> {
    if (this.#state.kind !== 'connected') {
      this.#state = {
        kind: 'connected',
        path: binding.path,
        conn: new SqliteConnectionImpl(openConnection(binding.path)),
      };
    }
  }

  async acquireConnection(): Promise<SqliteConnectionImpl> {
    const { path } = this.#requireConnected();
    return new SqliteConnectionImpl(openConnection(path));
  }

  async close(): Promise<void> {
    if (this.#state.kind !== 'connected') return;
    const { conn } = this.#state;
    this.#state = { kind: 'closed' };
    await conn.release();
  }

  async *execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    yield* this.#requireConnected().conn.execute<Row>(request);
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    return this.#requireConnected().conn.explain(request);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    return this.#requireConnected().conn.query<Row>(sql, params);
  }
}

export function createBoundDriverFromBinding(binding: SqliteBinding): SqlDriver<SqliteBinding> {
  return new SqliteBoundDriver({
    kind: 'connected',
    path: binding.path,
    conn: new SqliteConnectionImpl(openConnection(binding.path)),
  });
}
