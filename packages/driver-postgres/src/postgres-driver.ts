import { Pool, Client } from 'pg';
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
  readonly connectionString?: string;
  readonly client?: Client;
  readonly cursor?: {
    readonly batchSize?: number;
    readonly disabled?: boolean;
  };
  readonly poolFactory?: typeof Pool;
  readonly closeClientOnClose?: boolean;
}

const DEFAULT_BATCH_SIZE = 100;

export class PostgresDriver implements SqlDriver {
  private readonly mode: 'pool' | 'client';
  private readonly pool?: Pool;
  private readonly client?: Client;
  private readonly cursorBatchSize: number;
  private readonly cursorDisabled: boolean;
  private connected = false;
  private readonly closeClientOnClose: boolean;

  constructor(options: PostgresDriverOptions) {
    if (options.client) {
      this.mode = 'client';
      this.client = options.client;
      this.closeClientOnClose = options.closeClientOnClose ?? false;
    } else {
      if (!options.connectionString) {
        throw new Error('PostgresDriver requires either connectionString or client');
      }
      const PoolImpl: typeof Pool = options.poolFactory ?? Pool;
      this.pool = new PoolImpl({ connectionString: options.connectionString });
      this.mode = 'pool';
      this.closeClientOnClose = false;
    }
    this.cursorBatchSize = options.cursor?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.cursorDisabled = options.cursor?.disabled ?? false;
  }

  async connect(): Promise<void> {
    await this.ensureConnected();
  }

  async *execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    await this.ensureConnected();
    const client = await this.acquireClient();
    const release = this.releaseClient.bind(this, client);
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
      await release();
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
    await this.ensureConnected();
    const client = await this.acquireClient();
    try {
      const result = await client.query(sql, params as unknown[] | undefined);
      return result as unknown as SqlQueryResult<Row>;
    } finally {
      await this.releaseClient(client);
    }
  }

  async close(): Promise<void> {
    if (this.mode === 'pool' && this.pool) {
      await this.pool.end();
    }
    if (this.mode === 'client' && this.closeClientOnClose && this.client) {
      await this.client.end();
    }
    this.connected = false;
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }
    const client = await this.acquireClient();
    try {
      await client.query('select 1');
      this.connected = true;
    } finally {
      await this.releaseClient(client);
    }
  }

  private async acquireClient(): Promise<PoolClient | Client> {
    if (this.mode === 'pool') {
      return this.pool!.connect();
    }
    return this.client!;
  }

  private async releaseClient(client: PoolClient | Client): Promise<void> {
    if (this.mode === 'pool') {
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
