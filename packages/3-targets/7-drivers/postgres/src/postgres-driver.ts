import type {
  SqlConnection,
  SqlDriver,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlQueryable,
  SqlQueryResult,
  SqlTransaction,
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

type ConnectionOptions = {
  readonly cursorBatchSize: number;
  readonly cursorDisabled: boolean;
};

abstract class PostgresQueryable<C extends PoolClient | Client = PoolClient | Client>
  implements SqlQueryable
{
  abstract acquireClient(): Promise<C>;
  abstract releaseClient(client: C): Promise<void>;

  protected readonly options: ConnectionOptions;

  constructor(options: ConnectionOptions) {
    this.options = options;
  }

  async *execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const client = await this.acquireClient();
    try {
      if (!this.options.cursorDisabled) {
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
      const result = await client
        .query(text, request.params as unknown[] | undefined)
        .catch(rethrowNormalizedError);
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
      const result = await client
        .query(sql, params as unknown[] | undefined)
        .catch(rethrowNormalizedError);
      return result as unknown as SqlQueryResult<Row>;
    } finally {
      await this.releaseClient(client);
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
        const rows = await readCursor(cursor, this.options.cursorBatchSize);
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

class PostgresConnectionImpl extends PostgresQueryable implements SqlConnection {
  #connection: PoolClient | Client;

  constructor(connection: PoolClient | Client, options: ConnectionOptions) {
    super(options);
    this.#connection = connection;
  }

  override acquireClient(): Promise<PoolClient | Client> {
    return Promise.resolve(this.#connection);
  }

  override releaseClient(_client: PoolClient | Client): Promise<void> {
    return Promise.resolve();
  }

  async beginTransaction(): Promise<SqlTransaction> {
    await this.#connection.query('BEGIN').catch(rethrowNormalizedError);
    return new PostgresTransactionImpl(this.#connection, this.options);
  }

  async release(): Promise<void> {
    if ('release' in this.#connection) {
      this.#connection.release();
    } else {
      await this.#connection.end();
    }
  }
}

class PostgresTransactionImpl extends PostgresQueryable implements SqlTransaction {
  #connection: PoolClient | Client;

  constructor(connection: PoolClient | Client, options: ConnectionOptions) {
    super(options);
    this.#connection = connection;
  }

  override acquireClient(): Promise<PoolClient | Client> {
    return Promise.resolve(this.#connection);
  }

  override releaseClient(_client: PoolClient | Client): Promise<void> {
    return Promise.resolve();
  }

  async commit(): Promise<void> {
    await this.#connection.query('COMMIT').catch(rethrowNormalizedError);
  }

  async rollback(): Promise<void> {
    await this.#connection.query('ROLLBACK').catch(rethrowNormalizedError);
  }
}

class PostgresPoolDriverImpl extends PostgresQueryable<PoolClient> implements SqlDriver {
  private readonly pool: PoolType;

  constructor(options: PostgresDriverOptions & { connect: { pool: PoolType } }) {
    super({
      cursorBatchSize: options.cursor?.batchSize ?? DEFAULT_BATCH_SIZE,
      cursorDisabled: options.cursor?.disabled ?? false,
    });
    this.pool = options.connect.pool;
  }

  async connect(): Promise<void> {
    // No-op: caller controls connecting the underlying client or pool
  }

  async acquireConnection(): Promise<SqlConnection> {
    const client = await this.acquireClient();
    return new PostgresConnectionImpl(client, this.options);
  }

  async close(): Promise<void> {
    // Check if pool is already closed to avoid "Called end on pool more than once" error
    // pg Pool has an 'ended' property that indicates if the pool has been closed
    if (!(this.pool as { ended?: boolean }).ended) {
      await this.pool.end();
    }
  }

  async acquireClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async releaseClient(client: PoolClient): Promise<void> {
    client.release();
  }
}

class PostgresDirectDriverImpl extends PostgresQueryable<Client> implements SqlDriver {
  private readonly directClient: Client;

  constructor(options: PostgresDriverOptions & { connect: { client: Client } }) {
    super({
      cursorBatchSize: options.cursor?.batchSize ?? DEFAULT_BATCH_SIZE,
      cursorDisabled: options.cursor?.disabled ?? false,
    });
    this.directClient = options.connect.client;
  }

  async connect(): Promise<void> {
    // No-op: caller controls connecting the underlying client or pool
  }

  async acquireConnection(): Promise<SqlConnection> {
    // TODO: This might need to be protected with a mutex.
    const client = await this.acquireClient();
    return new PostgresConnectionImpl(client, this.options);
  }

  async close(): Promise<void> {
    const client = this.directClient as Client & { _ending?: boolean };
    if (!client._ending) {
      await client.end();
    }
  }

  async acquireClient(): Promise<Client> {
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

  async releaseClient(_client: Client): Promise<void> {}
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
  return new PostgresPoolDriverImpl({
    connect: { pool },
    cursor: options?.cursor,
  });
}

export function createPostgresDriverFromOptions(options: PostgresDriverOptions): SqlDriver {
  if ('pool' in options.connect) {
    return new PostgresPoolDriverImpl(
      options as PostgresDriverOptions & { connect: { pool: PoolType } },
    );
  }
  if ('client' in options.connect) {
    return new PostgresDirectDriverImpl(
      options as PostgresDriverOptions & { connect: { client: Client } },
    );
  }
  throw new Error('PostgresDriver requires a pool or client');
}

function readCursor<Row>(cursor: Cursor<Row>, size: number): Promise<Row[]> {
  return callbackToPromise<Row[]>((cb) => {
    cursor.read(size, (err, rows) => cb(err, rows));
  });
}

function closeCursor(cursor: Cursor<unknown>): Promise<void> {
  return callbackToPromise((cb) => cursor.close(cb));
}

function rethrowNormalizedError(error: unknown): never {
  throw normalizePgError(error);
}
