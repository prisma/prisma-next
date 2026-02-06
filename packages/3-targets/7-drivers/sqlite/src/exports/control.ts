import { errorRuntime } from '@prisma-next/core-control-plane/errors';
import type {
  ControlDriverDescriptor,
  ControlDriverInstance,
} from '@prisma-next/core-control-plane/types';
import { SqlQueryError } from '@prisma-next/sql-errors';
import { ifDefined } from '@prisma-next/utils/defined';
import { redactDatabaseUrl } from '@prisma-next/utils/redact-db-url';
import type { BunDatabase } from '../bun-sqlite';
import { createBunDatabase } from '../bun-sqlite';
import { sqliteDriverDescriptorMeta } from '../core/descriptor-meta';
import type { DatabaseSync } from '../node-sqlite';
import { createDatabaseSync } from '../node-sqlite';
import { normalizeSqliteError } from '../normalize-error';
import { resolveSqliteFilename } from '../resolve-filename';

type SqliteEngine = 'node' | 'bun';
type SqliteDatabase = DatabaseSync | BunDatabase;

function isBunRuntime(): boolean {
  const bun = (globalThis as { Bun?: unknown }).Bun;
  return typeof bun === 'object' && bun !== null;
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

function normalizeSqlitePlaceholders(sql: string): string {
  // Prisma Next raw lane emits $1, $2, ... placeholders. SQLite uses ?1, ?2, ...
  return sql.replace(/\$(\d+)/g, '?$1');
}

type StatementRunResult = {
  readonly changes: number | bigint;
  readonly lastInsertRowid?: number | bigint;
};

type StatementLike = {
  all: (...params: unknown[]) => unknown[];
  run: (...params: unknown[]) => StatementRunResult;
} & ({ columns: () => readonly unknown[] } | { readonly columnNames: readonly string[] });

function statementReturnsRows(stmt: StatementLike): boolean {
  return 'columns' in stmt ? stmt.columns().length > 0 : stmt.columnNames.length > 0;
}

/**
 * SQLite control driver instance for control-plane operations.
 * Implements ControlDriverInstance<'sql', 'sqlite'> for database queries.
 */
export class SqliteControlDriver implements ControlDriverInstance<'sql', 'sqlite'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'sqlite' as const;
  /**
   * @deprecated Use targetId instead
   */
  readonly target = 'sqlite' as const;

  constructor(
    private readonly engine: SqliteEngine,
    private readonly db: SqliteDatabase,
  ) {}

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }> {
    try {
      const normalizedSql = normalizeSqlitePlaceholders(sql);
      const stmt = this.db.prepare(normalizedSql) as StatementLike;
      const usesNumericPlaceholders = /\?\d/.test(normalizedSql);
      const bindings =
        this.engine === 'node' && usesNumericPlaceholders ? toNumericBindings(params) : undefined;
      const returnsRows = statementReturnsRows(stmt);

      if (!returnsRows) {
        if (this.engine === 'node' && usesNumericPlaceholders) {
          bindings ? stmt.run(bindings) : stmt.run();
          return { rows: [] };
        }

        if (params && params.length > 0) {
          stmt.run(...params);
          return { rows: [] };
        }

        stmt.run();
        return { rows: [] };
      }

      const rows = (
        this.engine === 'node' && usesNumericPlaceholders
          ? bindings
            ? stmt.all(bindings)
            : stmt.all()
          : params && params.length > 0
            ? stmt.all(...params)
            : stmt.all()
      ) as Row[];
      return { rows };
    } catch (error) {
      throw normalizeSqliteError(error);
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/**
 * SQLite driver descriptor for CLI config.
 */
const sqliteDriverDescriptor: ControlDriverDescriptor<'sql', 'sqlite', SqliteControlDriver> = {
  ...sqliteDriverDescriptorMeta,
  async create(url: string): Promise<SqliteControlDriver> {
    const filename = resolveSqliteFilename(url);

    try {
      const engine: SqliteEngine = isBunRuntime() ? 'bun' : 'node';
      const db: SqliteDatabase =
        engine === 'node' ? createDatabaseSync(filename) : createBunDatabase(filename);
      // Default safety: enforce FK constraints unless explicitly disabled by app.
      db.exec('PRAGMA foreign_keys = ON');
      ensureMinimumSqlite(db);
      return new SqliteControlDriver(engine, db);
    } catch (error) {
      const normalized = normalizeSqliteError(error);
      const redacted = redactDatabaseUrl(url);

      const codeFromSqlState = SqlQueryError.is(normalized) ? normalized.sqlState : undefined;
      const code =
        codeFromSqlState ??
        ('cause' in normalized && normalized.cause
          ? ((normalized.cause as { code?: unknown }).code as string | undefined)
          : undefined);

      throw errorRuntime('Database connection failed', {
        why: normalized.message,
        fix: 'Verify the sqlite file path (prefer a file: URL), ensure the directory exists, and confirm file permissions',
        meta: {
          ...ifDefined('code', code),
          ...redacted,
          ...(!Object.keys(redacted).length ? { filename } : {}),
        },
      });
    }
  },
};

export default sqliteDriverDescriptor;
