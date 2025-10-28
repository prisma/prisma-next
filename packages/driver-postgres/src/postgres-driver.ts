import { Pool } from 'pg';
import type { PoolClient, QueryResult as PgQueryResult, QueryResultRow } from 'pg';
import Cursor from 'pg-cursor';

import type {
  SqlDriver,
  SqlExecuteRequest,
  SqlQueryResult,
  SqlExplainResult,
} from '@prisma-next/sql-target';

export type QueryResult<T extends QueryResultRow = QueryResultRow> = PgQueryResult<T>;

export interface PostgresDriverOptions {
  readonly connectionString: string;
  readonly cursor?: {
    readonly batchSize?: number;
    readonly disabled?: boolean;
  };
  readonly poolFactory?: typeof Pool;
}

const DEFAULT_BATCH_SIZE = 100;

export class PostgresDriver implements SqlDriver {
  private readonly pool: Pool;
  private readonly cursorBatchSize: number;
  private readonly cursorDisabled: boolean;
  private connected = false;

  constructor(options: PostgresDriverOptions) {
    const PoolImpl: typeof Pool = options.poolFactory ?? Pool;
    this.pool = new PoolImpl({ connectionString: options.connectionString });
    this.cursorBatchSize = options.cursor?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.cursorDisabled = options.cursor?.disabled ?? false;
  }

  async connect(): Promise<void> {
    await this.ensureConnected();
  }

  async *execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    await this.ensureConnected();

    const client = await this.pool.connect();
    try {
      if (!this.cursorDisabled) {
        try {
          for await (const row of this.executeWithCursor(client, request.sql, request.params)) {
            yield row as Row;
          }
          return;
        } catch (cursorError) {
          if (!(cursorError instanceof Error)) {
            throw cursorError;
          }
        }
      }

      for await (const row of this.executeBuffered(client, request.sql, request.params)) {
        yield row as Row;
      }
    } finally {
      client.release();
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    const text = `EXPLAIN (FORMAT JSON) ${request.sql}`;
    const result = await this.pool.query(text, request.params as unknown[] | undefined);
    return { rows: result.rows as ReadonlyArray<Record<string, unknown>> };
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    await this.ensureConnected();
    const result = await this.pool.query(sql, params as unknown[] | undefined);
    return result as unknown as SqlQueryResult<Row>;
  }

  async close(): Promise<void> {
    await this.pool.end();
    this.connected = false;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }

    await this.pool.query('select 1');
    this.connected = true;
  }

  private async *executeWithCursor(
    client: PoolClient,
    sql: string,
    params: readonly unknown[] | undefined,
  ): AsyncIterable<Record<string, unknown>> {
    const cursor = client.query(new Cursor(sql, params as unknown[] | undefined));

    try {
      while (true) {
        const rows = await readCursor(cursor, this.cursorBatchSize);
        if (rows.length === 0) {
          break;
        }

        for (const row of rows) {
          yield row;
        }
      }
    } finally {
      await closeCursor(cursor);
    }
  }

  private async *executeBuffered(
    client: PoolClient,
    sql: string,
    params: readonly unknown[] | undefined,
  ): AsyncIterable<Record<string, unknown>> {
    const result = await client.query(sql, params as unknown[] | undefined);
    for (const row of result.rows as Record<string, unknown>[]) {
      yield row;
    }
  }
}

export function createPostgresDriver(options: PostgresDriverOptions): SqlDriver {
  return new PostgresDriver(options);
}

function readCursor<Row>(cursor: Cursor<Row>, size: number): Promise<Row[]> {
  return new Promise<Row[]>((resolve, reject) => {
    cursor.read(size, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(rows ?? []);
    });
  });
}

function closeCursor(cursor: Cursor<unknown>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    cursor.close((err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve();
    });
  });
}
