/**
 * Hand-built fakes for `@prisma/ppg` types. Tests import these and pass them
 * to the driver via the `{ kind: 'ppgClient' }` binding, so we exercise the
 * real driver lifecycle without standing up a WebSocket server or mocking the
 * `@prisma/ppg` module.
 */
import type { Column, Client as PpgClient, Resultset, Row, Session } from '@prisma/ppg';

export interface ResultsetSpec {
  readonly columns: ReadonlyArray<Column>;
  readonly rows: ReadonlyArray<Row>;
}

export type QueryHandler = (
  sql: string,
  params: readonly unknown[],
) => ResultsetSpec | Promise<ResultsetSpec> | Error | Promise<Error>;

/**
 * Convenience handler for transaction tests: returns an empty resultset for
 * any SQL whose first keyword is `BEGIN` / `COMMIT` / `ROLLBACK` (PPG
 * accepts these via `session.query` and returns an empty resultset). For
 * anything else, defers to the supplied inner handler.
 */
export function withTxnControlStatements(
  inner: QueryHandler = () => ({ columns: [], rows: [] }),
): QueryHandler {
  return (sql, params) => {
    const head = sql.trim().slice(0, 8).toUpperCase();
    if (head.startsWith('BEGIN') || head.startsWith('COMMIT') || head.startsWith('ROLLBACK')) {
      return { columns: [], rows: [] };
    }
    return inner(sql, params);
  };
}

export interface FakeClientControls {
  readonly client: PpgClient;
  readonly newSessionCalls: () => number;
  readonly queryCalls: () => Array<{ sql: string; params: readonly unknown[] }>;
  readonly sessionCloseCalls: () => number;
  /**
   * Alias for `queryCalls` — query history observed across every fake session
   * the client minted. Each entry carries the `sql` and `params` arguments
   * passed to `session.query(sql, ...params)`. Useful for transaction tests
   * that assert the exact `BEGIN` / `COMMIT` / `ROLLBACK` ordering.
   */
  readonly sessionQueryHistory: () => Array<{ sql: string; params: readonly unknown[] }>;
  /**
   * Alias for `sessionCloseCalls` — total number of `session.close()` calls
   * across every fake session. Useful for tests asserting one-session-per-call
   * vs held-session lifecycles.
   */
  readonly closeCount: () => number;
}

export function makeFakeClient(handler: QueryHandler): FakeClientControls {
  let newSessionCount = 0;
  let sessionCloseCount = 0;
  const queryCalls: Array<{ sql: string; params: readonly unknown[] }> = [];

  const newSession = async (): Promise<Session> => {
    newSessionCount++;
    let active = true;
    const session: Session = {
      query: async (sql: string, ...params: unknown[]): Promise<Resultset> => {
        queryCalls.push({ sql, params });
        const out = await handler(sql, params);
        if (out instanceof Error) {
          throw out;
        }
        return makeResultset(out);
      },
      exec: async (_sql: string, ..._params: unknown[]): Promise<number> => {
        throw new Error('fake-client: exec not implemented for tests');
      },
      close: () => {
        sessionCloseCount++;
        active = false;
      },
      get active() {
        return active;
      },
      [Symbol.dispose]() {
        this.close();
      },
    };
    return session;
  };

  const client: PpgClient = {
    newSession,
    query: async (_sql: string, ..._params: unknown[]) => {
      throw new Error('fake-client: top-level query not used by the driver');
    },
    exec: async (_sql: string, ..._params: unknown[]) => {
      throw new Error('fake-client: top-level exec not used by the driver');
    },
  };

  return {
    client,
    newSessionCalls: () => newSessionCount,
    queryCalls: () => queryCalls,
    sessionCloseCalls: () => sessionCloseCount,
    sessionQueryHistory: () => queryCalls,
    closeCount: () => sessionCloseCount,
  };
}

function makeResultset(spec: ResultsetSpec): Resultset {
  const rows = [...spec.rows];
  let i = 0;
  const iter = {
    async next(): Promise<IteratorResult<Row>> {
      if (i < rows.length) {
        const value = rows[i++] as Row;
        return { value, done: false };
      }
      return { value: undefined, done: true };
    },
    async return(): Promise<IteratorResult<Row>> {
      i = rows.length;
      return { value: undefined, done: true };
    },
    async collect(): Promise<Row[]> {
      const remaining = rows.slice(i);
      i = rows.length;
      return remaining;
    },
    [Symbol.asyncIterator]() {
      return iter;
    },
  };
  return {
    columns: [...spec.columns],
    rows: iter as unknown as Resultset['rows'],
  };
}

export function col(name: string, oid = 25): Column {
  return { name, oid };
}

export function row(...values: unknown[]): Row {
  return { values };
}
