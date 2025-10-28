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

class PostgresDriverImpl implements PostgresDriver {
  private readonly pool: Pool;
  private readonly cursorBatchSize: number;
  private readonly cursorDisabled: boolean;
  private connected = false;

  constructor(private readonly options: PostgresDriverOptions) {
    const PoolImpl: typeof Pool = options.poolFactory ?? Pool;
    this.pool = new PoolImpl({ connectionString: options.connectionString });
    this.cursorBatchSize = options.cursor?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.cursorDisabled = options.cursor?.disabled ?? false;
  }

  async connect(): Promise<void> {
    await this.ensureConnected();
  }

  async *execute<Row extends QueryResultRow = QueryResultRow>(
    request: ExecuteRequest,
  ): AsyncIterable<Row> {
    await this.ensureConnected();

    const client = await this.pool.connect();
    try {
      if (!this.cursorDisabled) {
        try {
          yield* this.executeWithCursor<Row>(client, request.sql, request.params);
          return;
        } catch (cursorError) {
          if (!(cursorError instanceof Error)) {
            throw cursorError;
          }
        }
      }

      yield* this.executeBuffered<Row>(client, request.sql, request.params);
    } finally {
      client.release();
    }
  }

  async explain(request: ExecuteRequest): Promise<ExplainResult> {
    const text = `EXPLAIN (FORMAT JSON) ${request.sql}`;
    const result = await this.pool.query(text, request.params as unknown[] | undefined);
    return { rows: result.rows as ReadonlyArray<Record<string, unknown>> };
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    await this.ensureConnected();
    const result = await this.pool.query<T>(sql, params as unknown[] | undefined);
    return result;
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

  private async *executeWithCursor<Row extends QueryResultRow>(
    client: PoolClient,
    sql: string,
    params: readonly unknown[] | undefined,
  ): AsyncIterable<Row> {
    const cursor = client.query(new Cursor(sql, params as unknown[] | undefined));

    try {
      while (true) {
        const rows: Row[] = await readCursor<Row>(cursor, this.cursorBatchSize);
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

  private async *executeBuffered<Row extends QueryResultRow>(
    client: PoolClient,
    sql: string,
    params: readonly unknown[] | undefined,
  ): AsyncIterable<Row> {
    const result = await client.query<Row>(sql, params as unknown[] | undefined);
    for (const row of result.rows) {
      yield row;
    }
  }
}

export function createPostgresDriver(options: PostgresDriverOptions): PostgresDriver {
  return new PostgresDriverImpl(options);
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
