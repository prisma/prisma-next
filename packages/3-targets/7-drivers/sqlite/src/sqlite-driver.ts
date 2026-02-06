import { existsSync } from 'node:fs';
import type {
  SqlConnection,
  SqlDriver,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlQueryable,
  SqlQueryResult,
  SqlTransaction,
} from '@prisma-next/sql-relational-core/ast';
import type { BunDatabase } from './bun-sqlite';
import { createBunDatabase } from './bun-sqlite';
import type { DatabaseSync } from './node-sqlite';
import { createDatabaseSync } from './node-sqlite';
import { normalizeSqliteError } from './normalize-error';
import { resolveSqliteFilename } from './resolve-filename';

export type SqliteEngine = 'node' | 'bun';
export type SqliteEngineMode = SqliteEngine | 'auto';

export type SqliteConnectOptions = {
  readonly readonly?: boolean;
  readonly fileMustExist?: boolean;
  readonly timeoutMs?: number;
};

type SqliteUserFunction = { bivarianceHack(...args: unknown[]): unknown }['bivarianceHack'];

export interface SqliteDriverOptions {
  /**
   * Driver backend implementation.
   *
   * - `auto` (default): use bun:sqlite when running under Bun, otherwise node:sqlite.
   * - `node`: force node:sqlite (Node runtime only)
   * - `bun`: force bun:sqlite (Bun runtime only)
   */
  readonly engine?: SqliteEngineMode | undefined;
  readonly connect:
    | {
        readonly filename: string;
        readonly options?: SqliteConnectOptions | undefined;
      }
    | {
        /**
         * Alias for filename that matches other drivers/configs.
         * Supports `file:` URLs (including Prisma-style `file:./dev.db`).
         */
        readonly connectionString: string;
        readonly options?: SqliteConnectOptions | undefined;
      }
    | { readonly database: DatabaseSync };
  /**
   * Pragmas to apply when opening the connection (e.g., foreign_keys, journal_mode).
   *
   * Note: Keep this minimal; policy/production tuning belongs in app config.
   */
  readonly pragmas?: Record<string, string | number | boolean | null | undefined> | undefined;
  /**
   * Optional user-defined functions to register on the connection.
   *
   * This is intentionally generic: callers can use it for extension packs or app-specific helpers.
   */
  readonly functions?: Record<string, SqliteUserFunction> | undefined;
}

export interface CreateSqliteDriverOptions {
  /**
   * Back-compat convenience option. Prefer `connectionString`.
   *
   * Accepts either a filesystem path or a `file:` connection string.
   */
  readonly filename?: string;
  /**
   * Accepts either a filesystem path or a `file:` connection string.
   */
  readonly connectionString?: string;
  readonly engine?: SqliteDriverOptions['engine'];
  readonly options?: SqliteConnectOptions | undefined;
  readonly pragmas?: SqliteDriverOptions['pragmas'];
  readonly functions?: SqliteDriverOptions['functions'];
}

type SqliteDatabase = DatabaseSync | BunDatabase;
type ConnectionOptions = {
  readonly owned: boolean;
  readonly engine: SqliteEngine;
  readonly db: SqliteDatabase;
};

function normalizeSqlitePlaceholders(sql: string): string {
  // Prisma Next raw lane emits $1, $2, ... placeholders. SQLite uses ?1, ?2, ...
  return sql.replace(/\$(\d+)/g, '?$1');
}

function isBunRuntime(): boolean {
  const bun = (globalThis as { Bun?: unknown }).Bun;
  return typeof bun === 'object' && bun !== null;
}

function resolveEngine(mode: SqliteEngineMode | undefined): SqliteEngine {
  if (mode && mode !== 'auto') {
    if (mode === 'bun' && !isBunRuntime()) {
      throw new Error('SqliteDriverOptions.engine is "bun" but this runtime is not Bun');
    }
    return mode;
  }

  return isBunRuntime() ? 'bun' : 'node';
}

function inferEngineFromDatabase(db: SqliteDatabase): SqliteEngine {
  // node:sqlite exposes db.function(). bun:sqlite does not.
  const record = db as { readonly function?: unknown };
  return typeof record.function === 'function' ? 'node' : 'bun';
}

function parseVersion(version: string): readonly [number, number, number] {
  const [major, minor, patch] = version.split('.', 3).map((s) => Number.parseInt(s ?? '0', 10));
  return Object.freeze([major || 0, minor || 0, patch || 0]);
}

function isVersionGte(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): boolean {
  const [amaj, amin, apat] = a;
  const [bmaj, bmin, bpat] = b;

  if (amaj !== bmaj) {
    return amaj > bmaj;
  }
  if (amin !== bmin) {
    return amin > bmin;
  }
  return apat >= bpat;
}

function ensureMinimumSqlite(db: SqliteDatabase): void {
  try {
    const row = db.prepare('select sqlite_version() as v').get() as
      | { readonly v?: unknown }
      | undefined;
    const version = typeof row?.v === 'string' ? row.v : String(row?.v ?? '');
    const parsed = parseVersion(version);
    const required = Object.freeze([3, 38, 0] as const);
    if (!isVersionGte(parsed, required)) {
      throw new Error(`SQLite ${required.join('.')}+ is required (detected ${version})`);
    }

    // JSON1 is required for includeMany lowering + sqlite-vector.
    db.prepare("select json_object('a', 1) as j").get();
    db.prepare(
      'select json_group_array(value) as a from (select 1 as value union all select 2 as value)',
    ).get();
  } catch (error) {
    throw normalizeSqliteError(error);
  }
}

type StatementRunResult = {
  readonly changes: number | bigint;
  readonly lastInsertRowid?: number | bigint;
};

type StatementLike = {
  all: (...params: unknown[]) => unknown[];
  iterate: (...params: unknown[]) => Iterable<unknown>;
  run: (...params: unknown[]) => StatementRunResult;
  get: (...params: unknown[]) => unknown;
} & ({ columns: () => readonly unknown[] } | { readonly columnNames: readonly string[] });

function statementReturnsRows(stmt: StatementLike): boolean {
  return 'columns' in stmt ? stmt.columns().length > 0 : stmt.columnNames.length > 0;
}

abstract class SqliteQueryable implements SqlQueryable {
  protected abstract getDb(): SqliteDatabase;
  protected abstract getEngine(): SqliteEngine;

  async *execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const db = this.getDb();
    const engine = this.getEngine();
    const sql = normalizeSqlitePlaceholders(request.sql);
    const usesNumericPlaceholders = /\?\d/.test(sql);
    const params = request.params;
    const bindings =
      engine === 'node' && usesNumericPlaceholders ? toNumericBindings(params) : undefined;

    try {
      const stmt = db.prepare(sql) as StatementLike;
      const returnsRows = statementReturnsRows(stmt);

      if (returnsRows) {
        const iterator =
          engine === 'node' && usesNumericPlaceholders
            ? bindings
              ? stmt.iterate(bindings)
              : stmt.iterate()
            : params && params.length > 0
              ? stmt.iterate(...params)
              : stmt.iterate();
        for (const row of iterator) {
          yield row as Row;
        }
        return;
      }

      if (engine === 'node' && usesNumericPlaceholders) {
        bindings ? stmt.run(bindings) : stmt.run();
        return;
      }

      if (params && params.length > 0) {
        stmt.run(...params);
        return;
      }

      stmt.run();
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async explain(requestOrSql: SqlExecuteRequest): Promise<SqlExplainResult>;
  async explain(sql: string, params?: readonly unknown[]): Promise<SqlExplainResult>;
  async explain(
    requestOrSql: SqlExecuteRequest | string,
    params?: readonly unknown[],
  ): Promise<SqlExplainResult> {
    const request: SqlExecuteRequest =
      typeof requestOrSql === 'string'
        ? params
          ? { sql: requestOrSql, params }
          : { sql: requestOrSql }
        : requestOrSql;

    const db = this.getDb();
    const engine = this.getEngine();
    const sql = normalizeSqlitePlaceholders(request.sql);
    const usesNumericPlaceholders = /\?\d/.test(sql);
    const requestParams = request.params;
    const bindings =
      engine === 'node' && usesNumericPlaceholders ? toNumericBindings(requestParams) : undefined;

    try {
      const stmt = db.prepare(`EXPLAIN QUERY PLAN ${sql}`) as StatementLike;
      const rows = (
        engine === 'node' && usesNumericPlaceholders
          ? bindings
            ? stmt.all(bindings)
            : stmt.all()
          : requestParams && requestParams.length > 0
            ? stmt.all(...requestParams)
            : stmt.all()
      ) as Array<Record<string, unknown>>;
      return { rows };
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    const db = this.getDb();
    const engine = this.getEngine();
    const normalizedSql = normalizeSqlitePlaceholders(sql);
    const usesNumericPlaceholders = /\?\d/.test(normalizedSql);
    const bindings =
      engine === 'node' && usesNumericPlaceholders ? toNumericBindings(params) : undefined;

    try {
      const stmt = db.prepare(normalizedSql) as StatementLike;
      const returnsRows = statementReturnsRows(stmt);

      if (returnsRows) {
        const rows = (
          engine === 'node' && usesNumericPlaceholders
            ? bindings
              ? stmt.all(bindings)
              : stmt.all()
            : params && params.length > 0
              ? stmt.all(...params)
              : stmt.all()
        ) as Row[];
        return { rows, rowCount: rows.length };
      }

      const result =
        engine === 'node' && usesNumericPlaceholders
          ? bindings
            ? stmt.run(bindings)
            : stmt.run()
          : params && params.length > 0
            ? stmt.run(...params)
            : stmt.run();
      return {
        rows: [],
        rowCount: typeof result.changes === 'bigint' ? Number(result.changes) : result.changes,
        lastInsertRowid:
          typeof result.lastInsertRowid === 'bigint'
            ? Number(result.lastInsertRowid)
            : result.lastInsertRowid,
      };
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }
}

class SqliteConnectionImpl extends SqliteQueryable implements SqlConnection {
  constructor(
    private readonly engine: SqliteEngine,
    private readonly db: SqliteDatabase,
  ) {
    super();
  }

  protected getDb(): SqliteDatabase {
    return this.db;
  }

  protected getEngine(): SqliteEngine {
    return this.engine;
  }

  async beginTransaction(): Promise<SqlTransaction> {
    try {
      // Use IMMEDIATE to acquire a write lock early (single writer).
      this.db.exec('BEGIN IMMEDIATE');
      return new SqliteTransactionImpl(this.engine, this.db);
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async release(): Promise<void> {
    // Single-connection driver; no-op.
  }
}

class SqliteTransactionImpl extends SqliteQueryable implements SqlTransaction {
  constructor(
    private readonly engine: SqliteEngine,
    private readonly db: SqliteDatabase,
  ) {
    super();
  }

  protected getDb(): SqliteDatabase {
    return this.db;
  }

  protected getEngine(): SqliteEngine {
    return this.engine;
  }

  async commit(): Promise<void> {
    try {
      this.db.exec('COMMIT');
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async rollback(): Promise<void> {
    try {
      this.db.exec('ROLLBACK');
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }
}

class SqliteDriverImpl extends SqliteQueryable implements SqlDriver {
  constructor(private readonly conn: ConnectionOptions) {
    super();
  }

  protected getDb(): SqliteDatabase {
    return this.conn.db;
  }

  protected getEngine(): SqliteEngine {
    return this.conn.engine;
  }

  async connect(): Promise<void> {
    // No-op: connection is established at construction time.
  }

  async acquireConnection(): Promise<SqlConnection> {
    return new SqliteConnectionImpl(this.conn.engine, this.conn.db);
  }

  async close(): Promise<void> {
    if (this.conn.owned) {
      this.conn.db.close();
    }
  }
}

function applyPragmas(db: SqliteDatabase, pragmas: SqliteDriverOptions['pragmas']): void {
  if (!pragmas) {
    return;
  }

  for (const [key, value] of Object.entries(pragmas)) {
    if (value === undefined) {
      continue;
    }

    const normalized =
      value === null
        ? 'NULL'
        : typeof value === 'boolean'
          ? value
            ? 'ON'
            : 'OFF'
          : typeof value === 'number'
            ? String(value)
            : `'${String(value).replace(/'/g, "''")}'`;

    db.exec(`PRAGMA ${key} = ${normalized}`);
  }
}

function registerFunctions(
  engine: SqliteEngine,
  db: SqliteDatabase,
  functions: SqliteDriverOptions['functions'],
): void {
  if (!functions) {
    return;
  }

  if (engine !== 'node') {
    throw new Error('SQLite driver functions are only supported on the node:sqlite backend');
  }

  for (const [name, fn] of Object.entries(functions)) {
    (db as DatabaseSync).function(name, fn);
  }
}

function toNumericBindings(params?: readonly unknown[]): Record<string, unknown> | undefined {
  if (!params || params.length === 0) {
    return undefined;
  }
  const bindings: Record<string, unknown> = {};
  for (let i = 0; i < params.length; i++) {
    bindings[String(i + 1)] = params[i];
  }
  return bindings;
}

export function createSqliteDriverFromOptions(options: SqliteDriverOptions): SqlDriver {
  if ('database' in options.connect) {
    const inferred = inferEngineFromDatabase(options.connect.database);
    if (options.engine && options.engine !== 'auto' && options.engine !== inferred) {
      throw new Error(
        `SqliteDriverOptions.engine is "${options.engine}" but the provided database handle looks like "${inferred}"`,
      );
    }
    const engine = inferred;
    try {
      applyPragmas(options.connect.database, options.pragmas);
      registerFunctions(engine, options.connect.database, options.functions);
      ensureMinimumSqlite(options.connect.database);
      return Object.freeze(
        new SqliteDriverImpl({ owned: false, engine, db: options.connect.database }),
      );
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  const engine = resolveEngine(options.engine);
  const connectionString =
    'connectionString' in options.connect
      ? options.connect.connectionString
      : options.connect.filename;
  const filename = resolveSqliteFilename(connectionString);
  if (options.connect.options?.fileMustExist && filename !== ':memory:' && !existsSync(filename)) {
    // Mirror sqlite open errors as closely as we can for nicer envelopes.
    const error = new Error(`SQLite database file does not exist: ${filename}`);
    (error as { code?: string }).code = 'ERR_SQLITE_ERROR';
    (error as { errcode?: number }).errcode = 14; // SQLITE_CANTOPEN
    throw normalizeSqliteError(error);
  }

  try {
    const db =
      engine === 'node'
        ? createDatabaseSync(filename, {
            readOnly: options.connect.options?.readonly ?? false,
            timeout: options.connect.options?.timeoutMs,
          })
        : createBunDatabase(filename, {
            readonly: options.connect.options?.readonly ?? false,
            readwrite: !(options.connect.options?.readonly ?? false),
            create: !(options.connect.options?.fileMustExist ?? false),
          });

    // Default safety: enforce FK constraints unless explicitly disabled.
    applyPragmas(
      db,
      Object.freeze({
        foreign_keys: 'ON',
        ...(options.connect.options?.timeoutMs
          ? { busy_timeout: options.connect.options.timeoutMs }
          : {}),
        ...options.pragmas,
      }),
    );
    registerFunctions(engine, db, options.functions);
    ensureMinimumSqlite(db);

    return Object.freeze(new SqliteDriverImpl({ owned: true, engine, db }));
  } catch (error) {
    throw normalizeSqliteError(error);
  }
}

export function createSqliteDriver(options: CreateSqliteDriverOptions): SqlDriver {
  const connectionString = options.connectionString ?? options.filename;
  if (!connectionString) {
    throw new Error('createSqliteDriver requires connectionString or filename');
  }
  return createSqliteDriverFromOptions({
    engine: options.engine,
    connect: { connectionString, options: options.options },
    pragmas: options.pragmas,
    functions: options.functions,
  });
}
