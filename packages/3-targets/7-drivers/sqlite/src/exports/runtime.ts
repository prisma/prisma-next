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
import { sqliteDriverDescriptorMeta } from '../core/descriptor-meta';
import { createBoundDriverFromBinding, type SqliteBinding } from '../sqlite-driver';

export type SqliteRuntimeDriver = RuntimeDriverInstance<'sql', 'sqlite'> & SqlDriver<SqliteBinding>;

const USE_BEFORE_CONNECT_MESSAGE =
  'SQLite driver not connected. Call connect(binding) before acquireConnection or execute.';
const ALREADY_CONNECTED_MESSAGE =
  'SQLite driver already connected. Call close() before reconnecting with a new binding.';

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

class SqliteUnboundDriverImpl implements SqliteRuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'sqlite' as const;

  #delegate: SqlDriver<SqliteBinding> | null = null;
  #closed = false;

  get state(): 'unbound' | 'connected' | 'closed' {
    if (this.#delegate !== null) {
      return 'connected';
    }
    if (this.#closed) {
      return 'closed';
    }
    return 'unbound';
  }

  #requireDelegate(): SqlDriver<SqliteBinding> {
    const delegate = this.#delegate;
    if (delegate === null) {
      throw driverError('DRIVER.NOT_CONNECTED', USE_BEFORE_CONNECT_MESSAGE);
    }
    return delegate;
  }

  async connect(binding: SqliteBinding): Promise<void> {
    if (this.#delegate !== null) {
      throw driverError('DRIVER.ALREADY_CONNECTED', ALREADY_CONNECTED_MESSAGE, {
        bindingKind: binding.kind,
      });
    }
    this.#delegate = createBoundDriverFromBinding(binding);
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

const sqliteRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'sql',
  'sqlite',
  void,
  SqliteRuntimeDriver
> = {
  ...sqliteDriverDescriptorMeta,
  create(): SqliteRuntimeDriver {
    return new SqliteUnboundDriverImpl();
  },
};

export default sqliteRuntimeDriverDescriptor;
export type { SqliteBinding } from '../sqlite-driver';
