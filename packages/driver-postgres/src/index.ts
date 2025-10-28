import { Pool } from 'pg';
import type { PoolClient, QueryResult as PgQueryResult, QueryResultRow } from 'pg';
import Cursor from 'pg-cursor';

export type QueryResult<T extends QueryResultRow = QueryResultRow> = PgQueryResult<T>;

export interface ExecuteRequest {
  readonly sql: string;
  readonly params?: readonly unknown[];
}

export interface ExplainResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

export interface PostgresDriver {
  connect(): Promise<void>;
  execute<Row extends QueryResultRow = QueryResultRow>(request: ExecuteRequest): AsyncIterable<Row>;
  explain?(request: ExecuteRequest): Promise<ExplainResult>;
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  close(): Promise<void>;
}

export interface PostgresDriverOptions {
  readonly connectionString: string;
  readonly cursor?: {
    readonly batchSize?: number;
    readonly disabled?: boolean;
  };
  readonly poolFactory?: typeof Pool;
}

const DEFAULT_BATCH_SIZE = 100;

export function createPostgresDriver(options: PostgresDriverOptions): PostgresDriver {
  const PoolImpl: typeof Pool = options.poolFactory ?? Pool;
  const pool = new PoolImpl({ connectionString: options.connectionString });
  const cursorBatchSize = options.cursor?.batchSize ?? DEFAULT_BATCH_SIZE;
  const cursorDisabled = options.cursor?.disabled ?? false;

  let connected = false;

  async function ensureConnected() {
    if (connected) {
      return;
    }

    await pool.query('select 1');
    connected = true;
  }

  async function* executeWithCursor<Row extends QueryResultRow>(
    client: PoolClient,
    sql: string,
    params: readonly unknown[] | undefined,
  ): AsyncIterable<Row> {
    const cursor = client.query(new Cursor(sql, params as unknown[] | undefined));

    try {
      while (true) {
        const rows: Row[] = await readCursor<Row>(cursor, cursorBatchSize);
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

  async function* executeBuffered<Row extends QueryResultRow>(
    client: PoolClient,
    sql: string,
    params: readonly unknown[] | undefined,
  ): AsyncIterable<Row> {
    const result = await client.query<Row>(sql, params as unknown[] | undefined);
    for (const row of result.rows) {
      yield row;
    }
  }

  return {
    async connect() {
      await ensureConnected();
    },

    async *execute<Row extends QueryResultRow = QueryResultRow>(
      request: ExecuteRequest,
    ): AsyncIterable<Row> {
      await ensureConnected();

      const client = await pool.connect();
      try {
        if (!cursorDisabled) {
          try {
            yield* executeWithCursor<Row>(client, request.sql, request.params);
            return;
          } catch (cursorError) {
            // Fall back to buffered execution if cursor is not supported
            if (!(cursorError instanceof Error)) {
              throw cursorError;
            }
          }
        }

        yield* executeBuffered<Row>(client, request.sql, request.params);
      } finally {
        client.release();
      }
    },

    async explain(request: ExecuteRequest): Promise<ExplainResult> {
      const text = `EXPLAIN (FORMAT JSON) ${request.sql}`;
      const result = await pool.query(text, request.params as unknown[] | undefined);
      return { rows: result.rows as ReadonlyArray<Record<string, unknown>> };
    },

    async query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<T>> {
      await ensureConnected();
      const result = await pool.query<T>(sql, params as unknown[] | undefined);
      return result;
    },

    async close() {
      await pool.end();
      connected = false;
    },
  };
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
