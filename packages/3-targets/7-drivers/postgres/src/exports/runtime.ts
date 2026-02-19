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

interface DriverRuntimeError extends Error {
  readonly code: 'DRIVER.NOT_CONNECTED' | 'DRIVER.ALREADY_CONNECTED';
  readonly category: 'RUNTIME';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

function driverError(
  code: DriverRuntimeError['code'],
  message: string,
  details?: Record<string, unknown>,
): DriverRuntimeError {
  const error = new Error(message) as DriverRuntimeError;
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });
  return Object.assign(error, {
    code,
    category: 'RUNTIME' as const,
    severity: 'error' as const,
    message,
    details,
  });
}

function unboundExecute<Row>(): AsyncIterable<Row> {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          throw driverError('DRIVER.NOT_CONNECTED', USE_BEFORE_CONNECT_MESSAGE);
        },
      };
    },
  };
}

class PostgresUnboundDriverImpl implements PostgresRuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  #delegate: SqlDriver<PostgresBinding> | null = null;
  #closed = false;
  #cursorOpts: PostgresDriverCreateOptions['cursor'];

  constructor(cursorOpts?: PostgresDriverCreateOptions['cursor']) {
    this.#cursorOpts = cursorOpts;
  }

  get state(): 'unbound' | 'connected' | 'closed' {
    if (this.#delegate !== null) {
      return 'connected';
    }
    if (this.#closed) {
      return 'closed';
    }
    return 'unbound';
  }

  #requireDelegate(): SqlDriver<PostgresBinding> {
    const delegate = this.#delegate;
    if (delegate === null) {
      throw driverError('DRIVER.NOT_CONNECTED', USE_BEFORE_CONNECT_MESSAGE);
    }
    return delegate;
  }

  async connect(binding: PostgresBinding): Promise<void> {
    if (this.#delegate !== null) {
      throw driverError('DRIVER.ALREADY_CONNECTED', ALREADY_CONNECTED_MESSAGE, {
        bindingKind: binding.kind,
      });
    }
    this.#delegate = createBoundDriverFromBinding(binding, this.#cursorOpts);
    this.#closed = false;
  }

  async acquireConnection(): Promise<SqlConnection> {
    const delegate = this.#requireDelegate();
    return delegate.acquireConnection();
  }

  async close(): Promise<void> {
    const delegate = this.#delegate;
    if (delegate !== null) {
      this.#delegate = null;
      await delegate.close();
    }
    this.#closed = true;
  }

  execute<Row = Record<string, unknown>>(request: SqlExecuteRequest): AsyncIterable<Row> {
    const delegate = this.#delegate;
    if (delegate === null) {
      return unboundExecute<Row>();
    }
    return delegate.execute<Row>(request);
  }

  async explain(request: SqlExecuteRequest): Promise<SqlExplainResult> {
    const delegate = this.#requireDelegate();
    const explain = delegate.explain;
    if (explain === undefined) {
      throw driverError('DRIVER.NOT_CONNECTED', USE_BEFORE_CONNECT_MESSAGE);
    }
    return explain.call(delegate, request);
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<SqlQueryResult<Row>> {
    const delegate = this.#requireDelegate();
    return delegate.query<Row>(sql, params);
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
