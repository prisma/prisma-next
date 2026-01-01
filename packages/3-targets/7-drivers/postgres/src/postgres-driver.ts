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
import { callbackToPromise } from './callback-to-promise';
import { isAlreadyConnectedError, isPostgresError, normalizePgError } from './normalize-error';

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
          // Check if this is a pg error - if so, normalize and throw
          // Otherwise, fall back to buffered mode for cursor-specific errors
          if (isPostgresError(cursorError)) {
            throw normalizePgError(cursorError);
          }
          // Not a pg error - cursor-specific error, fall back to buffered mode
        }
      }

      for await (const row of this.executeBuffered(client, request.sql, request.params)) {
        yield row as Row;
      }
    } catch (error) {
      throw normalizePgError(error);
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
    } catch (error) {
      throw normalizePgError(error);
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
    } catch (error) {
      throw normalizePgError(error);
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
    if (this.directClient) {
      const client = this.directClient as Client & { _ending?: boolean };
      if (!client._ending) {
        await client.end();
      }
    }
  }

  private async acquireClient(): Promise<PoolClient | Client> {
    if (this.pool) {
      return this.pool.connect();
    }
    if (this.directClient) {
      // Check if client is already connected before attempting to connect
      // This prevents hanging when the database only supports a single connection
      // pg's Client has internal connection state that we can check
      const client = this.directClient as Client & {
        _ending?: boolean;
        _connection?: unknown;
      };
      const isConnected =
        client._connection !== undefined && client._connection !== null && !client._ending;

      // Only connect if not already connected
      // If caller provided a connected client (e.g., in tests), use it as-is
      if (!isConnected) {
        try {
          await this.directClient.connect();
        } catch (error: unknown) {
          // If already connected, pg throws an error - ignore it and proceed
          // Re-throw other errors (actual connection failures)
          if (!isAlreadyConnectedError(error)) {
            throw error;
          }
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
    } catch (error) {
      throw normalizePgError(error);
    } finally {
      await closeCursor(cursor);
    }
  }

  private async *executeBuffered(
    client: PoolClient | Client,
    sql: string,
    params: readonly unknown[] | undefined,
  ): AsyncIterable<Record<string, unknown>> {
    try {
      const result = await client.query(sql, params as unknown[] | undefined);
      for (const row of result.rows as Record<string, unknown>[]) {
        yield row;
      }
    } catch (error) {
      normalizePgError(error);
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
  return callbackToPromise<Row[]>((cb) => {
    cursor.read(size, (err, rows) => cb(err, rows));
  });
}

function closeCursor(cursor: Cursor<unknown>): Promise<void> {
  return callbackToPromise((cb) => cursor.close(cb));
}
