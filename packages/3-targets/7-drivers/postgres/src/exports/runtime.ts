import type {
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
} from '@prisma-next/core-execution-plane/types';
import type {
  SqlConnection,
  SqlDriver,
  SqlExecuteRequest,
  SqlExplainResult,
  SqlQueryResult,
} from '@prisma-next/sql-relational-core/ast';
import { postgresDriverDescriptorMeta } from '../core/descriptor-meta';
import {
  createBoundDriverFromBinding,
  type PostgresBinding,
  type PostgresDriverCreateOptions,
} from '../postgres-driver';

export type PostgresRuntimeDriver = RuntimeDriverInstance<'sql', 'postgres'> &
  SqlDriver<PostgresBinding>;

const USE_BEFORE_CONNECT_MESSAGE =
  'Postgres driver not connected. Call connect(binding) before acquireConnection or execute.';
const ALREADY_CONNECTED_MESSAGE =
  'Postgres driver already connected. Call close() before reconnecting with a new binding.';

class PostgresUnboundDriverImpl implements PostgresRuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  #delegate: SqlDriver<PostgresBinding> | null = null;
  #cursorOpts: PostgresDriverCreateOptions['cursor'];

  constructor(cursorOpts?: PostgresDriverCreateOptions['cursor']) {
    this.#cursorOpts = cursorOpts;
  }

  async connect(binding: PostgresBinding): Promise<void> {
    if (this.#delegate !== null) {
      throw new Error(ALREADY_CONNECTED_MESSAGE);
    }
    this.#delegate = createBoundDriverFromBinding(binding, this.#cursorOpts);
  }

  async acquireConnection(): Promise<SqlConnection> {
    if (this.#delegate === null) {
      throw new Error(USE_BEFORE_CONNECT_MESSAGE);
    }
    return this.#delegate.acquireConnection();
  }

  async close(): Promise<void> {
    if (this.#delegate !== null) {
      await this.#delegate.close();
      this.#delegate = null;
    }
  }

  execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    if (this.#delegate === null) {
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              throw new Error(USE_BEFORE_CONNECT_MESSAGE);
            },
            async return() {
              return { done: true, value: undefined };
            },
            async throw(error?: unknown) {
              throw error ?? new Error(USE_BEFORE_CONNECT_MESSAGE);
            },
          };
        },
      };
    }
    return this.#delegate.execute<Row>(request);
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    if (this.#delegate === null) {
      throw new Error(USE_BEFORE_CONNECT_MESSAGE);
    }
    if (!this.#delegate.explain) {
      throw new Error('Postgres driver does not support explain()');
    }
    return this.#delegate.explain(request);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    if (this.#delegate === null) {
      throw new Error(USE_BEFORE_CONNECT_MESSAGE);
    }
    return this.#delegate.query<Row>(sql, params);
  }
}

const postgresRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'sql',
  'postgres',
  PostgresDriverCreateOptions,
  PostgresRuntimeDriver
> = {
  ...postgresDriverDescriptorMeta,
  create(options?: PostgresDriverCreateOptions): PostgresRuntimeDriver {
    return new PostgresUnboundDriverImpl(options?.cursor);
  },
};

export default postgresRuntimeDriverDescriptor;
export type {
  PostgresBinding,
  PostgresDriverCreateOptions,
  QueryResult,
} from '../postgres-driver';
