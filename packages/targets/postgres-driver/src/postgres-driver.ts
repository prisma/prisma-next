import type {
  SqlDriver,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlQueryResult,
} from '@prisma-next/sql-relational-core/ast';
import type {
  Client,
  QueryResult as PgQueryResult,
  PoolClient,
  Pool as PoolType,
  QueryResultRow,
} from 'pg';
import { Pool } from 'pg';
import Cursor from 'pg-cursor';

export type QueryResult<T extends QueryResultRow = QueryResultRow> = PgQueryResult<T>;

export interface PostgresDriverOptions {
  readonly connect: { client: Client } | { pool: PoolType };
  readonly cursor?:
    | {
        readonly batchSize?: number;
        readonly disabled?: boolean;
      }
    | undefined;
}

const DEFAULT_BATCH_SIZE = 100;

class PostgresDriverImpl implements SqlDriver {
  private readonly pool: PoolType | undefined;
  private readonly directClient: Client | undefined;
  private readonly cursorBatchSize: number;
  private readonly cursorDisabled: boolean;

  constructor(options: PostgresDriverOptions) {
    if ('client' in options.connect) {
      this.directClient = options.connect.client;
    } else if ('pool' in options.connect) {
      this.pool = options.connect.pool;
    } else {
      throw new Error('PostgresDriver requires a pool or client');
    }

    this.cursorBatchSize = options.cursor?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.cursorDisabled = options.cursor?.disabled ?? false;
  }

  async connect(): Promise<void> {
    // No-op: caller controls connecting the underlying client or pool
  }

  async *execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const client = await this.acquireClient();
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
      await this.releaseClient(client);
    }
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    const text = `EXPLAIN (FORMAT JSON) ${request.sql}`;
    const client = await this.acquireClient();
    try {
      const result = await client.query(text, request.params as unknown[] | undefined);
      return { rows: result.rows as ReadonlyArray<Record<string, unknown>> };
    } finally {
      await this.releaseClient(client);
    }
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    const client = await this.acquireClient();
    try {
      const result = await client.query(sql, params as unknown[] | undefined);
      return result as unknown as SqlQueryResult<Row>;
    } finally {
      await this.releaseClient(client);
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      // Check if pool is already closed to avoid "Called end on pool more than once" error
      // pg Pool has an 'ended' property that indicates if the pool has been closed
      if (!(this.pool as { ended?: boolean }).ended) {
        await this.pool.end();
      }
    }
  }

  private async acquireClient(): Promise<PoolClient | Client> {
    if (this.pool) {
      return this.pool.connect();
    }
    if (this.directClient) {
      // Lazy connection: connect if not already connected
      // This allows tests to manage their own connections while still supporting lazy connection
      // pg's Client.connect() will throw if already connected, so we catch and ignore that case
      try {
        await this.directClient.connect();
      } catch (error: unknown) {
        // If already connected, pg throws an error - ignore it and proceed
        // Re-throw other errors (actual connection failures)
        if (error instanceof Error) {
          const message = error.message.toLowerCase();
          if (!message.includes('already') && !message.includes('connected')) {
            throw error;
          }
        } else {
          throw error;
        }
      }
      return this.directClient;
    }
    throw new Error('PostgresDriver requires a pool or client');
  }

  private async releaseClient(client: PoolClient | Client): Promise<void> {
    if (this.pool) {
      (client as PoolClient).release();
    }
  }

  private async *executeWithCursor(
    client: PoolClient | Client,
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
    client: PoolClient | Client,
    sql: string,
    params: readonly unknown[] | undefined,
  ): AsyncIterable<Record<string, unknown>> {
    const result = await client.query(sql, params as unknown[] | undefined);
    for (const row of result.rows as Record<string, unknown>[]) {
      yield row;
    }
  }
}

export interface CreatePostgresDriverOptions {
  readonly cursor?: PostgresDriverOptions['cursor'];
  readonly poolFactory?: typeof Pool;
}

export function createPostgresDriver(
  connectionString: string,
  options?: CreatePostgresDriverOptions,
): SqlDriver {
  const PoolImpl: typeof Pool = options?.poolFactory ?? Pool;
  const pool = new PoolImpl({ connectionString });
  return new PostgresDriverImpl({
    connect: { pool },
    cursor: options?.cursor,
  });
}

export function createPostgresDriverFromOptions(options: PostgresDriverOptions): SqlDriver {
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
